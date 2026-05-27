import { z } from 'zod';
import { tool } from '@openai/agents';
import { evaluateCredibilityHelper, readUniResourceLoc, runWebSearch, writeFileMD } from './tool-helpers.ts';

export const readUrl = tool({
  name: 'readUrl',
  description: 'Read and evaluate a URL\'s content by fetching it with Jina Reader API. Returns content as Markdown',
  parameters: z.object({
    url: z.string().describe('The HTTP(s) URL to fetch'),
  }),
  execute: async ({ url }) => await readUniResourceLoc(url),
});

export const webSearch = tool({
  name: 'webSearch',
  description: 'Search the web for information. Returns a list of relevant URLs and snippets',
  parameters: z.object({
    query: z.string().describe('The search query'),
  }),
  execute: async ({ query }) => runWebSearch(query)
});

export const evaluateCredibility = tool({
  name: 'evaluateCredibility',
  description: 'Evaluate source credibility using a structured schema.',
  parameters: z.object({
    source_url: z.string().describe('The URL being evaluated'),
    source_type: z
      .enum([
        'peer_reviewed_journal',
        'news_organization',
        'government_agency',
        'nonprofit_organization',
        'corporate_blog',
        'personal_blog',
        'social_media',
        'wiki',
        'unknown',
      ])
      .describe(
        'One of: peer_reviewed_journal, news_organization, government_agency, nonprofit_organization, corporate_blog, personal_blog, social_media, wiki, unknown',
      ),
    author: z.object({
      name: z
        .string()
        .describe('Author name. If unknown after investigation, write "Unknown" and explain what you checked'),
      credentials: z
        .string()
        .describe("What qualifications does the author have? If you couldn't find them, describe what you searched for"),
      credibility_assessment: z
        .string()
        .describe('Your assessment of author credibility. If unknown, explain how this affects your overall assessment'),
    }),
    publication: z.object({
      name: z
        .string()
        .describe('Publication or website name. If not a recognized outlet, use the domain name'),
      reputation: z
        .string()
        .describe('What did your research reveal about this publication? If unknown, describe what you searched for'),
      editorial_process: z
        .enum(['peer_reviewed', 'editor_reviewed', 'self_published', 'unknown'])
        .describe('One of: peer_reviewed, editor_reviewed, self_published, unknown'),
    }),
    content_analysis: z.object({
      claims_supported_by_evidence: z
        .boolean()
        .describe('Are the main claims backed by data, citations, or primary sources?'),
      sources_cited: z.boolean().describe('Does the article cite its sources?'),
      corroborated_by_other_sources: z
        .boolean()
        .describe('Did you find other credible sources reporting the same claims?'),
      contradicted_by_other_sources: z
        .boolean()
        .describe('Did you find credible sources that contradict the claims?'),
      language_is_objective: z
        .boolean()
        .describe('Is the tone neutral and factual, or emotional and persuasive?'),
      date_published: z.string().describe('When was this published? Is it current?'),
    }),
    overall_credibility: z
      .enum(['high', 'medium', 'low', 'very_low'])
      .describe('One of: high, medium, low, very_low'),
    reasoning: z
      .string()
      .describe('Explain your overall credibility rating, citing specific evidence from your research'),
  }),
  // NOTE: this execute differs from the one of webSearch because it uses the whole object structure, not a specific destructured parameter such as "query" in the former tool.
  execute: async (input) => evaluateCredibilityHelper(input),
})

export const writeFile = tool({
    name: 'writeFile',
    description: 'Writes content as a string into a Markdown file with a specific name for this one.',
    parameters: z.object({
        contentFile: z.string().describe('The content to be inserted into a file.'),
        nameFile: z.string().describe('The name for the file where to insert data.'),
    }),
    execute: async ({contentFile, nameFile}) => writeFileMD(contentFile, nameFile,)
});