import type { LLMProvider, ProviderConfig } from './types.js';
import { loadProvidersConfig, type ProvidersFile } from './config.js';

type ProviderFactory = (name: string, config: ProviderConfig, model?: string) => Promise<LLMProvider>;

export class ProviderRegistry {
  private config: ProvidersFile;
  private factories = new Map<string, ProviderFactory>();
  private instances = new Map<string, LLMProvider>();

  constructor(configPath?: string) {
    this.config = loadProvidersConfig(configPath);
    this.registerDefaultFactories();
  }

  private registerDefaultFactories(): void {
    this.factories.set('anthropic', async (name, config, model) => {
      const { AnthropicProvider } = await import('./anthropic.js');
      return new AnthropicProvider(name, config.apiKey!, model ?? config.defaultModel ?? 'claude-sonnet-4-6');
    });
    this.factories.set('openai', async (name, config, model) => {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(name, config.apiKey!, model ?? config.defaultModel ?? 'gpt-4o', config.baseUrl);
    });
    this.factories.set('azure-openai', async (name, config, model) => {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(name, config.apiKey!, model ?? config.deployment ?? config.defaultModel ?? 'gpt-4o', config.baseUrl);
    });
    this.factories.set('gemini', async (name, config, model) => {
      const { GeminiProvider } = await import('./gemini.js');
      return new GeminiProvider(name, config.apiKey!, model ?? config.defaultModel ?? 'gemini-2.0-flash');
    });
    this.factories.set('bedrock', async (name, config, model) => {
      const { BedrockProvider } = await import('./bedrock.js');
      return new BedrockProvider(name, config.region ?? 'us-east-1', model ?? config.defaultModel ?? 'anthropic.claude-sonnet-4-6-20250514-v1:0');
    });
    this.factories.set('ollama', async (name, config, model) => {
      const { OllamaProvider } = await import('./ollama.js');
      return new OllamaProvider(name, model ?? config.defaultModel ?? 'llama3.1', config.baseUrl ?? 'http://localhost:11434');
    });
    this.factories.set('claude-code', async (name, _config, _model) => {
      const { ClaudeCodeProvider } = await import('./claude-code.js');
      return new ClaudeCodeProvider(name);
    });
  }

  async get(providerName: string, modelOverride?: string): Promise<LLMProvider> {
    const cacheKey = `${providerName}:${modelOverride ?? 'default'}`;
    const cached = this.instances.get(cacheKey);
    if (cached) return cached;

    const providerConfig = this.config.providers[providerName];
    if (!providerConfig) throw new Error(`Unknown provider: ${providerName}. Check ~/.sworm/providers.yaml`);

    const factory = this.factories.get(providerConfig.type);
    if (!factory) throw new Error(`No factory for provider type: ${providerConfig.type}`);

    const instance = await factory(providerName, providerConfig, modelOverride);
    this.instances.set(cacheKey, instance);
    return instance;
  }

  getDefaultProvider(): string | undefined {
    return this.config.defaults?.provider;
  }

  getDefaultModel(): string | undefined {
    return this.config.defaults?.model;
  }

  listProviders(): string[] {
    return Object.keys(this.config.providers);
  }
}
