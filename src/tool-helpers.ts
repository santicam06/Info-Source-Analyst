import dotenv from 'dotenv';
import { tavily } from '@tavily/core';
import path from 'path';

import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}

const tavilyClient = tavily({ apiKey: process.env.TAVILY_API_KEY || '' });

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const JINA_READ_TIMEOUT_MS = 15_000;
const JINA_MAX_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);


export async function readUniResourceLoc(url: string): Promise<string> {
	try {

		const trimmedUrl = url?.trim();
		if (!trimmedUrl) {
			throw new Error('URL is required.');
		}

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(trimmedUrl);
		} catch {
			throw new Error(`Invalid URL format: ${trimmedUrl}`);
		}

		if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
			throw new Error(`Unsupported protocol: ${parsedUrl.protocol}. Use http or https.`);
		}

		const stringURL = parsedUrl.toString();
		const jinaReaderURL = `https://r.jina.ai/${encodeURI(stringURL)}`;

		// Handles rate limit requests
		for (let attempt = 0; attempt <= JINA_MAX_RETRIES; attempt++) {
        
			const controller = new AbortController();
			// Prevents hanging requests, aborts after 15 secs
			const timeoutId = setTimeout(() => controller.abort(), JINA_READ_TIMEOUT_MS);

			// This try handles per-attempt errors
			try {
				const response = await fetch(jinaReaderURL, {
					// in case of abort 
					signal: controller.signal,
          
					// only accepts those headers, q is preference, higher is more priority
					headers: {
						// last one is any MIME type
						Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8',   
					},
				});

                // This can hadle errors like 404 which are NOT network errors
				if (!response.ok) {
					const errorBody = (await response.text()).slice(0, 300);
					const statusMessage = `Jina request failed: ${response.status} ${response.statusText}.`;

					if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < JINA_MAX_RETRIES) {
						await sleep(400 * (attempt + 1));
						continue;
					}

					throw new Error(`${statusMessage} Body preview: ${errorBody}`);
				}

				const contentType = response.headers.get('content-type') || '';
				if (contentType && !contentType.includes('text') && !contentType.includes('json')) {
					throw new Error(`Unexpected response content type: ${contentType}`);
				}

				const text = await response.text();
				if (!text.trim()) {
					throw new Error('Jina returned an empty response body.');
				}

				// Truncate to avoid blowing up the context window.
				return text.slice(0, 10000);

			} catch (error) {
				const isAbortError =
					error instanceof Error &&
					(error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'));

				// Wait 4 seconds after abort and retry if attempts remain
				if (isAbortError) {
					if (attempt < JINA_MAX_RETRIES) {
						await sleep(400 * (attempt + 1));
						continue;
					}
					throw new Error(`Jina request timed out after ${JINA_READ_TIMEOUT_MS}ms.`);
				}

				if (attempt < JINA_MAX_RETRIES) {
					await sleep(400 * (attempt + 1));
					continue;
				}

				throw error;
			} finally {
				clearTimeout(timeoutId);
			}
		}

		throw new Error('Jina request failed after retries with no successful response.');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const redactedUrl = url?.trim() || '[empty-url]';
		const safeUrl = redactedUrl.length > 200 ? `${redactedUrl.slice(0, 200)}...` : redactedUrl;

		throw new Error(`readUrl(): failed for URL -> "${safeUrl}": ${message}`);
	}
}

function formatWebSearch(response: TavilySearchResponse): string {
	const lines = [`Web search for query: ${response.query}\n`];

	if (response.answer) {
		lines.push(`Summary: ${response.answer}\n`);
	}

	lines.push('Sources:');
	response.results.forEach((result, i) => {
		lines.push(
			`\n${i + 1}. ${result.title}\n` +
			`   URL: ${result.url}\n` +
			`   Content: ${result.content}\n` +
			`   Relevance score: ${result.score.toFixed(2)}`
		);
	});

	return lines.join('\n');
}

export async function runWebSearch(query: string): Promise<string> {
	return formatWebSearch(
		await tavilyClient.search(
			query, {
			search_depth: 'advanced',
			max_results: 8,
			include_answer: true,
			include_raw_content: false,
			include_images: false,
		})
	)
}


export function evaluateCredibilityHelper(evaluation: object): object {
	return {
		status: 'evaluation_recorded',
		evaluation,
	};
}


const reportsDir = path.resolve(__dirname, '..', 'reports');
const MAX_MARKDOWN_BYTES = 200_000;
const MAX_FILENAME_LENGTH = 120;

export function writeFileMD(content: string, nameFile: string) {

		try {
				const cleanFileName = nameFile.trim();
				if (!cleanFileName) {
					throw new Error('File name is required.');
				}
     
				if (cleanFileName.length > MAX_FILENAME_LENGTH) {
					throw new Error(`File name is too long. Max length is ${MAX_FILENAME_LENGTH} characters.`);
				}
     
				// Prevents changing directory with file name
				if (cleanFileName.includes('/') || cleanFileName.includes('\\')) {
					throw new Error('File name must not contain path separators.');
				}
     
				// Verify unsupported characters in file name
				if (!/^[A-Za-z0-9._-]+$/.test(cleanFileName)) {
					throw new Error('File name contains unsupported characters. Use letters, numbers, dot, dash, and underscore only.');
				}
     
				// Verify Markdown extension
				const ext = path.extname(cleanFileName).toLowerCase();
				if (ext && ext !== '.md') {
					throw new Error('Only .md files are allowed.');
				}
     
				const finalFileName = ext === '.md' ? cleanFileName : `${cleanFileName}.md`;
     
				// Normalize line breaks and remove unsafe control chars 
				let sanitizedContent = content
					.replace(/\r\n?/g, '\n')
					.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
     
				// If markdown is rendered to HTML later, strip obvious script payloads
				sanitizedContent = sanitizedContent
					.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
					.replace(/\]\(\s*javascript:[^)]+\)/gi, '](#)')
					.replace(/\]\(\s*data:text\/html[^)]*\)/gi, '](#)');
     
				const contentBytes = Buffer.byteLength(sanitizedContent, 'utf8');
				if (contentBytes > MAX_MARKDOWN_BYTES) {
					throw new Error(`Content is too large. Max allowed size is ${MAX_MARKDOWN_BYTES} bytes.`);
				}
     
				/* Tries to create reports dir, if it exists already with the provided param path, does nothing. If some parent dirs of path already   exist,     skips them & creates missing ones before arriving to reports dir */
				mkdirSync(reportsDir, { recursive: true });
     
				// e.g. "reports/report_5.md"
				const writePath = path.resolve(reportsDir, finalFileName);

				// e.g. "reports"
				const reportsPrefix = reportsDir.endsWith(path.sep) ? reportsDir : `${reportsDir}${path.sep}`;
     
				// ensures directory is called "reports", nothing else like "reports-evil"
				if (!writePath.startsWith(reportsPrefix)) {
					throw new Error('Resolved file path is outside the allowed reports directory.');
				}
     
				/* write to a temp file first, in case of interruptions 
				is a fallback for half written contents */
				const tempPath = `${writePath}.tmp-${Date.now()}`;
     
				try {
					if (existsSync(writePath)) {
						throw new Error(`A report named "${finalFileName}" already exists. Choose a new file name.`);
					}
       
					// Write to temp first, then move into place.
					// wx is write if not existent
					writeFileSync(tempPath, sanitizedContent, { encoding: 'utf8', flag: 'wx' });

					// if no crashes when writing to temp, remove the suffix .tmp-..... of file
					renameSync(tempPath, writePath);
				} catch (error) {
					rmSync(tempPath, { force: true });

					if (error instanceof Error && error.message.includes('EEXIST')) {
						throw new Error(`A report named "${finalFileName}" already exists. Choose a new file name.`);
					}
       
					throw error;
				}
     
				// Debug
				console.error(`File name: ${finalFileName}\n Output dir: ${reportsDir}`);

				return {
					status: 'file_written',
					file_name: finalFileName,
					output_directory: reportsDir,
					bytes_written: contentBytes,
				};
		}
		catch (error) {
				throw new Error(`writeFileMD(): An error occurred -> ${error}`);
		}
}
