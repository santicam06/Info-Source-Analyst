/**
* This agent provides assistance for researching the credibility of a source of information.
* Performing a thoroughly search in the web to verify the authenticity, and using tools as aid.
*  
* States a final Markdown report providing the level of credibility, information of interest,
* and other sources of support to corroborate its statements.
*
* RUN AS ===> ts-node sources_analyst.ts 2> debug_example.txt
*/ 

import dotenv from 'dotenv';
import {
  Agent,
  Runner,
  setTracingDisabled,
  OpenAIChatCompletionsModel,
} from '@openai/agents';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import {readUrl, webSearch, evaluateCredibility, writeFile} from './tools.ts';

const instructPath = path.join(__dirname, 'INSTRUCTIONS.md');
let instructionsFile = fs.readFileSync(instructPath, 'utf-8');

// Read environment variables
const BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL_NAME = 'anthropic/claude-haiku-4.5';

if (!BASE_URL || !OPENROUTER_API_KEY || !MODEL_NAME) {
  throw new Error(
    'Please check your BASE_URL, OPENROUTER_API_KEY, MODEL_NAME via env var or code.',
  );
}

/**
 * This example uses a custom provider for some calls to Runner.run(), and direct calls to OpenAI for others.
 
 * Steps:
 * 1. Create a custom OpenAI client.
 * 2. Create a ModelProvider that uses the custom client.
 * 3. Use the ModelProvider in calls to Runner.run(), only when we want to use the custom LLM provider.
 */

const client = new OpenAI({ apiKey: OPENROUTER_API_KEY, baseURL: BASE_URL });

// ACTIVATE ONLY IF NO OPENAI_API_KEY PRESENT 
setTracingDisabled(true);        

// Gets a model instance
class CustomModelProvider {
  async getModel(modelName?: string) {
    return new OpenAIChatCompletionsModel(client as any, modelName || MODEL_NAME);
  }
}

const CUSTOM_MODEL_PROVIDER = new CustomModelProvider();

async function main() {
  const agent = new Agent({
    name: 'Assistant',
    instructions: instructionsFile,
    tools: [readUrl, webSearch, evaluateCredibility, writeFile],
  });

  // This will use the custom model provider
  const runner = new Runner({ modelProvider: CUSTOM_MODEL_PROVIDER });


  // ************************** === INSERT URL IN 2ND PARAMETER OF .RUN() === ************************************

  const result = await runner.run(agent, "https://medium.com/@cch.chichieh/understanding-reasoning-models-test-time-compute-insights-from-deepseek-r1-d30783070827", { maxTurns: 15});
  // The type of result can vary according SDK versions


  // TRACING SDK LOGS

  /* The structure of result may change at runtime,
    so its properties, we avoid type checking hence. */ 
  const runtimeResult = result as any;

  // Print which top level properties the result really has
  console.error('\nRuntime result top-level keys:', Object.keys(runtimeResult));

  // Print the whole object (with child properties)
  console.dir(runtimeResult, { depth: null });

  console.error('\nfinalOutput in run-time:', runtimeResult.finalOutput);


  /** 
   * SNIPPET TO CHECK STRUCTURE OF runtimeResult:

  console.error('\n=== CHECKING RESULT.STATE STRUCTURE ===');
  if (runtimeResult.state) {
    console.error('Keys in state:', Object.keys(runtimeResult.state));
    console.error('Full state object:');
    console.error(JSON.stringify(runtimeResult.state, null, 2));
  } else {
    console.error('No state property found');
  }
  */

  /** 
   *  Each "step" is one complete agent iteration where it:
   *    - Called one or more tools
   *    - Received results back
   *    - Generated the next response
  */

  // TOOLS CALL TRACING
  
  console.error('\n=== TOOL CALLS BREAKDOWN ===');

console.error('Checking: runtimeResult.state exists?', !!runtimeResult.state);
console.error('Checking: _modelResponses exists?', !!runtimeResult.state?._modelResponses);
console.error('Checking: _modelResponses length?', runtimeResult.state?._modelResponses?.length);

if (runtimeResult.state && runtimeResult.state._modelResponses) {
  const allToolCalls: any[] = [];
  
  console.error(`Found ${runtimeResult.state._modelResponses.length} model responses`);
  
  // Iterate through each model response (each turn)
  runtimeResult.state._modelResponses.forEach((response: any, responseIndex: number) => {
    console.error(`  Response ${responseIndex}: has output?`, !!response.output, 'is array?', Array.isArray(response.output));
    
    if (response.output && Array.isArray(response.output)) {
      const toolCalls = response.output.filter((item: any) => item.type === 'function_call');
      console.error(`Found ${toolCalls.length} tool calls in this response`);
      
      if (toolCalls.length > 0) {
        console.error(`\n  Step ${responseIndex + 1}: called ${toolCalls.map((tc: any) => tc.name).join(', ')}`);
        allToolCalls.push(...toolCalls);
      }
    }
  });
  
  console.error(`\nTotal tool calls: ${allToolCalls.length}`);
} else {
  console.error('ERROR: state or _modelResponses not found!');
}
  // END TOOLS CALL TRACING

  console.log('\nfinalOutput (typed):', result.finalOutput);

  
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});