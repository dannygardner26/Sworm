// Type stubs for optional LLM SDK dependencies.
// These are dynamically imported at runtime only when the provider is used.
// Install the actual package to get full types: npm install <package>

declare module '@anthropic-ai/sdk' {
  class Anthropic {
    constructor(opts: { apiKey: string });
    messages: {
      create(params: any): Promise<any>;
    };
  }
  export default Anthropic;
}

declare module 'openai' {
  class OpenAI {
    constructor(opts: { apiKey: string; baseURL?: string });
    chat: {
      completions: {
        create(params: any): Promise<any>;
      };
    };
  }
  export default OpenAI;
}

declare module '@google/generative-ai' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(opts: any): any;
  }
}

declare module '@aws-sdk/client-bedrock-runtime' {
  export class BedrockRuntimeClient {
    constructor(opts: { region: string });
    send(command: any): Promise<any>;
  }
  export class ConverseCommand {
    constructor(params: any);
  }
}
