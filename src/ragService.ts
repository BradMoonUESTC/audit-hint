

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { ConfigManager, ApiConfig } from './configManager';

interface Metadata {
    [key: string]: any;
    sim_score?: number;
}

interface PineconeMatch {
    id: string;
    metadata: {
        Title?: string;
        RiskLevel?: string;
        Functionality?: string;
        KeyConcept?: string;
        CodeExample?: string;
        Category?: string;
    };
    score: number;
}

export class RagService {
    private initialized: boolean = true; // 直接设置为已初始化
    private useExampleMode: boolean = false; // 修改为默认不使用示例模式
    private outputLanguage: string = 'zh'; // 添加语言设置，默认中文
    private cache: Map<string, { results: any[], timestamp: number }> = new Map(); // 明确缓存值类型
    private cacheMaxSize: number = 50; // 缓存最大条目数
    private cacheTimeout: number = 30 * 60 * 1000; // 缓存超时时间（30分钟）
    private config: ApiConfig;

    constructor() {
        // 获取配置
        this.config = ConfigManager.getConfig();
        
        // 设置环境变量
        process.env.OPENAI_API_BASE = this.config.openaiApiBase;
        process.env.OPENAI_API_KEY = this.config.openaiApiKey;
        
        console.log('RAG服务已初始化，使用实际漏洞检测模式');
        console.log('当前配置:', this.config);
    }

    // 更新配置
    public updateConfig(newConfig: ApiConfig): void {
        this.config = newConfig;
        
        // 更新环境变量
        process.env.OPENAI_API_BASE = this.config.openaiApiBase;
        process.env.OPENAI_API_KEY = this.config.openaiApiKey;
        
        console.log('RAG服务配置已更新');
        console.log('当前配置:', this.config);
    }

    // 切换示例模式
    public toggleExampleMode(useExample: boolean): void {
        this.useExampleMode = useExample;
        console.log(`已切换到${useExample ? '示例' : '实际'}漏洞模式`);
    }

    // 获取当前模式
    public getExampleMode(): boolean {
        return this.useExampleMode;
    }

    // 添加语言切换方法
    public setOutputLanguage(language: 'en' | 'zh'): void {
        this.outputLanguage = language;
        console.log(`输出语言已切换为: ${language === 'zh' ? '中文' : 'English'}`);
    }

    // 获取当前语言设置
    public getOutputLanguage(): string {
        return this.outputLanguage;
    }

    // 获取语言相关的提示语
    private getLanguagePrompt(): string {
        return `用${this.outputLanguage === 'zh' ? '中文' : 'English'}输出`;
    }

    /**
     * 生成缓存键
     * @param code 代码内容
     * @param language 代码语言
     * @returns 缓存键
     */
    private generateCacheKey(code: string, language: string): string {
        // 规范化代码，去除空白字符影响，并限制长度以避免过长的键
        const normalizedCode = code.trim();
        // 使用代码和语言的组合作为缓存键
        return `${language}:${normalizedCode.substring(0, 1000)}`;
    }

    /**
     * 从缓存中获取结果
     * @param code 代码内容
     * @param language 代码语言
     * @returns 缓存的结果，如果没有缓存则返回null
     */
    private getCachedResult(code: string, language: string): any[] | null {
        const cacheKey = this.generateCacheKey(code, language);
        const cachedItem = this.cache.get(cacheKey);
        
        if (cachedItem) {
            // 使用类型断言，先转为 unknown 再转为目标类型
            const { results, timestamp } = cachedItem as unknown as { results: any[], timestamp: number };
            const now = Date.now();
            
            // 检查缓存是否过期
            if (now - timestamp < this.cacheTimeout) {
                console.log('使用缓存结果');
                return results;
            } else {
                // 缓存已过期，删除
                console.log('缓存已过期');
                this.cache.delete(cacheKey);
            }
        }
        
        return null;
    }

    /**
     * 将结果存入缓存
     * @param code 代码内容
     * @param language 代码语言
     * @param results 漏洞结果
     */
    private cacheResult(code: string, language: string, results: any[]): void {
        // 如果缓存已满，删除最旧的条目
        if (this.cache.size >= this.cacheMaxSize) {
            console.log('缓存已满，删除最旧条目');
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        
        const cacheKey = this.generateCacheKey(code, language);
        this.cache.set(cacheKey, {
            results,
            timestamp: Date.now()
        });
        
        console.log(`结果已缓存`);
    }

    /**
     * 从代码中提取功能描述
     * @param code 代码内容
     * @returns 功能描述
     */
    private async getFunctionalityFromCode(code: string): Promise<string> {
        console.log('正在提取代码功能描述...');
        
        const prompt = `Given the following vulnerability description, following the task:
1. Describe the functionality implemented in the given code. This should be answered under the section "Functionality:" and written in the imperative mood, e.g., "Calculate the price of a token." Your response should be concise and limited to one paragraph and within 80-100 words.
2. Remember, do not contain any variable or function or expression name in the Functionality Result, focus on the functionality or business logic itself

${code}`;
        
        console.log('发送LLM请求获取功能描述...');
        const response = await this.commonAsk(prompt);
        console.log(`提取的功能描述: ${response.substring(0, 100)}...`);
        return response;
    }
    
    /**
     * 调用LLM获取回答
     * @param prompt 提示词
     * @returns LLM的回答
     */
    private async commonAsk(prompt: string): Promise<string> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            vscode.window.showErrorMessage('未设置OPENAI_API_KEY环境变量');
            return '';
        }
        
        const apiBase = process.env.OPENAI_API_BASE || 'api.openai.com';
        const model = process.env.AI_MODEL || 'gpt-4o';
        
        try {
            console.log(`正在调用LLM API (${apiBase})...`);
            const response = await axios.post(`https://${apiBase}/v1/chat/completions`, {
                model: model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('LLM响应成功');
            console.log(response.data.choices[0].message.content);
            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('LLM请求错误:', error);
            return '';
        }
    }

    /**
     * 生成文本的嵌入向量
     * @param text 要嵌入的文本
     * @returns 嵌入向量
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            vscode.window.showErrorMessage('未设置OPENAI_API_KEY环境变量');
            return [];
        }
        
        const apiBase = process.env.OPENAI_API_BASE || 'api.openai.com';
        const model = 'text-embedding-3-large';
        
        try {
            console.log('正在生成嵌入向量...');
            const requestUrl = `https://${apiBase}/v1/embeddings`;
            const requestBody = {
                input: text,
                model: model,
                encoding_format: "float"
            };
            console.log('请求URL:', requestUrl);
            console.log('请求参数:', JSON.stringify(requestBody, null, 2));
            
            const response = await axios.post(requestUrl, requestBody, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('嵌入向量生成成功');
            return response.data.data[0].embedding;
        } catch (error) {
            console.error('生成嵌入向量错误:', error);
            return [];
        }
    }

    /**
     * 查询Pinecone获取相似漏洞
     * @param embedding 嵌入向量
     * @param topK 返回结果数量
     * @returns 漏洞结果列表
     */
    private async queryPinecone(embedding: number[], topK: number = 6): Promise<any[]> {
        try {
            // 使用配置中的 Pinecone 信息
            const pineconeApiKey = this.config.pineconeApiKey;
            const pineconeHost = this.config.pineconeHost;
            const pineconeNamespace = this.config.pineconeNamespace;
            
            console.log(`正在查询Pinecone (${pineconeHost})...`);
            // 使用axios直接调用Pinecone API
            const response = await axios.post(`https://${pineconeHost}/query`, {
                vector: embedding,
                topK: topK,
                includeMetadata: true,
                includeValues: false,  // 不包含向量值以减少响应大小
                namespace: pineconeNamespace
            }, {
                headers: {
                    'Api-Key': pineconeApiKey,
                    'Content-Type': 'application/json'
                }
            });
            const response_medium = await axios.post(`https://${pineconeHost}/query`, {
                vector: embedding,
                topK: topK,
                includeMetadata: true,
                includeValues: false,  // 不包含向量值以减少响应大小
                namespace: 'vulns_medium'
            }, {
                headers: {
                    'Api-Key': pineconeApiKey,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Pinecone查询成功');
            
            // 添加调试日志
            console.log('response.data.matches:', response.data?.matches?.length || 0, '条结果');
            console.log('response_medium.data.matches:', response_medium.data?.matches?.length || 0, '条结果');
            
            // 处理响应数据
            let allMatches: PineconeMatch[] = [];
            if (response.data && response.data.matches) {
                allMatches = [...response.data.matches];
                console.log('第一个namespace结果数:', allMatches.length);
            }
            if (response_medium.data && response_medium.data.matches) {
                const beforeLength = allMatches.length;
                allMatches = [...allMatches, ...response_medium.data.matches];
                console.log('合并第二个namespace后结果数:', allMatches.length);
                console.log('新增了:', allMatches.length - beforeLength, '条结果');
            }
            
            // 输出一些示例数据
            if (allMatches.length > 0) {
                console.log('第一条结果示例:', {
                    id: allMatches[0].id,
                    score: allMatches[0].score,
                    metadata: allMatches[0].metadata
                });
            }
            
            if (allMatches.length > 0) {
                console.log(`找到 ${allMatches.length} 个匹配结果`);
                return allMatches.map((match: any) => {
                    console.log('处理匹配结果:', match.id);
                    return {
                        id: match.id,
                        title: match.metadata.Title || '未知漏洞',
                        severity: match.metadata.RiskLevel || 'medium',
                        description: match.metadata.Functionality || '无功能描述',
                        recommendation: match.metadata.KeyConcept || '无建议',
                        codeExample: match.metadata.CodeExample || '',
                        keyConcept: match.metadata.KeyConcept || '',
                        category: match.metadata.Category || '未分类',
                        similarityScore: match.score
                    };
                });
            } else {
                console.log('未找到匹配结果');
                return [];
            }
        } catch (error) {
            console.error('查询Pinecone错误:', error);
            return [];
        }
    }

    /**
     * 查询代码中的潜在漏洞
     * @param code 要检查的代码段
     * @param language 代码语言
     * @param threshold 匹配阈值
     * @param topK 返回top_k规则
     * @returns 漏洞结果列表
     */
    public async queryVulnerabilities(
        code: string,
        language: string,
        threshold: number = 0.1,
        topK: number = 3
    ): Promise<any[]> {
        try {
            console.log(`查询漏洞: ${language}`);
            
            // 检查缓存
            const cachedResults = this.getCachedResult(code, language);
            if (cachedResults) {
                return cachedResults;
            }
            
            console.log('缓存未命中');
            
            // 示例模式
            if (this.useExampleMode) {
                console.log('使用示例模式');
                const results = this.getExampleVulnerability(language);
                this.cacheResult(code, language, results);
                return results;
            }
            
            // 使用向量检索方式
            console.log('使用向量检索');
            
            // 1. 获取代码功能描述
            const functionality = await this.getFunctionalityFromCode(code);
            
            // 2. 将功能描述转换为嵌入向量
            const embedding = await this.generateEmbedding(functionality);
            if (embedding.length === 0) {
                console.error('生成嵌入向量失败');
                const results = this.getExampleVulnerability(language);
                this.cacheResult(code, language, results);
                return results;
            }
            
            // 3. 使用嵌入向量查询Pinecone获取相似漏洞
            const vulnerabilities = await this.queryPinecone(embedding, 6);
            
            if (vulnerabilities.length === 0) {
                console.log('未找到相关漏洞');
                const results = this.getExampleVulnerability(language);
                this.cacheResult(code, language, results);
                return results;
            }
            
            // 保存原始漏洞信息，用于后续翻译
            const originalVulnerabilities = [...vulnerabilities];
            
            // 4. 使用LLM进一步处理结果，传入选中的代码
            const results = await this.enhanceVulnerabilityResults(vulnerabilities, code);
            
            // 将结果存入缓存
            this.cacheResult(code, language, results);
            
            // 如果是增强后的结果（只有审计要点），则返回原始漏洞信息以便翻译
            if (results.length === 1 && results[0].auditPoints) {
                // 将原始漏洞信息附加到结果中，但不显示在UI上
                results[0].originalVulnerabilities = originalVulnerabilities;
            }
            
            return results;
        } catch (error) {
            console.error('查询漏洞失败:', error);
            vscode.window.showErrorMessage(`查询漏洞失败: ${error}`);
            return [];
        }
    }

    /**
     * 使用LLM增强漏洞结果
     * @param vulnerabilities 原始漏洞结果
     * @param selectedCode 用户选中的代码
     * @returns 增强后的漏洞结果
     */
    private async enhanceVulnerabilityResults(vulnerabilities: any[], selectedCode: string): Promise<any[]> {
        try {
            console.log('使用LLM增强漏洞结果...');
            
            // 准备所有漏洞的功能描述和关键概念的综合信息
            const vulnDescriptions = vulnerabilities.map((vuln, index) => {
                const functionality = vuln.description || '';
                const keyConcept = vuln.keyConcept || '';
                return `漏洞${index + 1}:
功能描述: ${functionality}
关键概念: ${keyConcept}`;
            }).join('\n\n');
            
            const basePrompt = this.outputLanguage === 'zh' 
                ? `基于以下所有漏洞的功能描述和关键概念，生成一个综合的审计检查要点列表。
这些要点应该涵盖所有相关漏洞的检查内容。`
                : `Based on the following vulnerability descriptions and key concepts, generate a comprehensive audit checklist.
These points should cover all relevant vulnerability checks.`;

            // 构建提示词 - 只生成一个综合的审计要点列表，限制为最多5个要点
            const prompt = `${basePrompt}

${vulnDescriptions}

代码片段:
\`\`\`
${selectedCode}
\`\`\`

${this.outputLanguage === 'zh' 
    ? `请提供最多5个最重要的审计检查要点，每个要点都要与所选代码直接相关。格式如下：

1. [第一个检查要点] - [清晰，易理解的解释]（解释中要包含具体代码）
2. [第二个检查要点] - [清晰，易理解的解释]（解释中要包含具体代码）
...

注意：要点应当简洁明了，重点突出，并按重要性排序。`
    : `Please provide up to 5 most important audit checkpoints, each directly related to the selected code. Format as follows:

1. [First checkpoint] - [Clear, understandable explanation] (explanation should include specific code)
2. [Second checkpoint] - [Clear, understandable explanation] (explanation should include specific code)
...

Note: Points should be concise, focused, and ordered by importance.`}

${this.getLanguagePrompt()}`;
            
            console.log('生成综合审计提示...');
            const auditPoints = await this.commonAsk(prompt);
            console.log('LLM返回的综合审计提示:', auditPoints);
            
            // 只返回一个包含审计要点的结果
            return [{
                auditPoints: auditPoints
            }];
        } catch (error) {
            console.error('生成审计要点失败:', error);
            return [{
                auditPoints: '未能生成审计要点'
            }];
        }
    }

    /**
     * 获取示例漏洞结果
     * @param language 代码语言
     * @returns 示例漏洞结果
     */
    private getExampleVulnerability(language: string): any[] {
        return [
            {
                id: 'example-vuln-1',
                title: '示例漏洞 - 输入验证不足',
                severity: 'high',
                description: '代码中可能存在输入验证不足的问题，可能导致注入攻击。',
                recommendation: '对所有用户输入进行严格验证和过滤，使用参数化查询防止SQL注入。',
                codeExample: '// 安全的做法\nconst query = "SELECT * FROM users WHERE id = ?";\ndb.execute(query, [userId]);',
                category: '输入验证',
                similarityScore: 0.95
            },
            {
                id: 'example-vuln-2',
                title: '示例漏洞 - 权限控制缺失',
                severity: 'medium',
                description: '代码可能缺少适当的权限控制，允许未授权访问敏感功能。',
                recommendation: '实现严格的访问控制机制，验证用户权限后再执行敏感操作。',
                category: '授权',
                similarityScore: 0.85
            },
            {
                id: 'example-vuln-3',
                title: '示例漏洞 - 敏感数据泄露',
                severity: 'medium',
                description: '代码可能在日志或错误消息中泄露敏感信息。',
                recommendation: '避免记录敏感数据，使用通用错误消息，不暴露内部实现细节。',
                category: '信息泄露',
                similarityScore: 0.75
            }
        ];
    }

    /**
     * 翻译漏洞的功能描述和关键概念
     * @param vulnerabilities 原始漏洞结果
     * @returns 翻译后的结果
     */
    public async translateVulnerabilityInfo(vulnerabilities: any[]): Promise<string> {
        try {
            console.log('开始翻译漏洞信息...');
            
            // 准备所有漏洞的功能描述和关键概念
            const vulnDescriptions = vulnerabilities.map((vuln, index) => {
                const functionality = vuln.description || '';
                const keyConcept = vuln.keyConcept || '';
                return `漏洞${index + 1}:
功能描述(Functionality): ${functionality}
关键概念(KeyConcept): ${keyConcept}`;
            }).join('\n\n');
            
            const prompt = `${this.outputLanguage === 'zh' 
                ? `将以下漏洞的功能描述和关键概念翻译成中文，相类似的漏洞可以合并：`
                : `Analyze the following vulnerability descriptions and key concepts, merge similar vulnerabilities:`}

${vulnDescriptions}

${this.outputLanguage === 'zh' 
    ? `相同的漏洞可以合并，并优化下翻译后的结构，输出优化结构后的翻译结果。遵循以下格式：

1. 漏洞1：
   发生场景：
   可能漏洞（要简略，准确，易于理解，不少于200个字）：
2. 漏洞2：
   发生场景：
   可能漏洞（要简略，准确，易于理解，不少于200个字）：`
    : `Similar vulnerabilities can be merged. Please follow this format:

1. Vulnerability 1:
   Scenario:
   Potential Issues (be concise, accurate, and easy to understand, minimum 200 words):
2. Vulnerability 2:
   Scenario:
   Potential Issues (be concise, accurate, and easy to understand, minimum 200 words):`}

${this.getLanguagePrompt()}`;
            
            console.log('发送翻译请求...');
            const translatedText = await this.commonAsk(prompt);
            console.log('翻译完成');
            
            return translatedText;
        } catch (error) {
            console.error('翻译漏洞信息失败:', error);
            return '翻译失败，请稍后再试';
        }
    }

    /**
     * 生成测试用例
     * @param code 要生成测试用例的代码段
     * @param language 代码语言
     * @returns 生成的测试用例
     */
    public async generateTestCases(code: string, language: string): Promise<string> {
        try {
            console.log('开始生成测试用例...');
            console.log('代码语言:', language);
            
            // 1. 获取代码功能描述
            const functionality = await this.getFunctionalityFromCode(code);
            console.log('提取的功能描述:', functionality);
            
            // 2. 将功能描述转换为嵌入向量
            const embedding = await this.generateEmbedding(functionality);
            if (embedding.length === 0) {
                console.error('生成嵌入向量失败');
                return '无法生成测试用例：生成嵌入向量失败';
            }
            console.log('嵌入向量生成成功，长度:', embedding.length);
            
            // 3. 使用嵌入向量查询Pinecone获取相似案例
            // 记录原始和修改后的host
            const originalHost = this.config.pineconeHost;
            console.log('原始 Pinecone Host:', originalHost);
            
            const testCaseHost = this.config.pineconeHost.replace('vulns', 'testcases');
            console.log('测试用例 Pinecone Host:', testCaseHost);
            
            this.config.pineconeHost = testCaseHost;
            
            console.log('开始查询相似测试用例...');
            const similarCases = await this.queryPinecone(embedding, 6);
            console.log('找到相似测试用例数量:', similarCases.length);
            
            // 恢复原始host
            this.config.pineconeHost = originalHost;
            
            if (similarCases.length === 0) {
                console.log('未找到相关的测试用例参考');
                return '未找到相关的测试用例参考';
            }
            
            // 4. 构建生成测试用例的prompt
            const casesInfo = similarCases.map((item: any) => {
                return `
功能描述: ${item.description}
测试用例: ${item.codeExample || '无示例'}
关键概念: ${item.keyConcept || '无'}`;
            }).join('\n\n');
            
            console.log('开始生成测试用例prompt...');
            
            const prompt = `${this.outputLanguage === 'zh' 
                ? `请基于以下信息为代码生成全面的测试用例。请严格遵循"使用知识"部分提供的测试案例模式，不要自行决定测试场景：`
                : `Please generate comprehensive test cases based on the following information. Strictly follow the test case patterns provided in the "Knowledge Base" section, do not create test scenarios on your own:`}

## 待测试代码
\`\`\`${language}
${code}
\`\`\`

## 代码功能描述
${functionality}

## 使用知识
${casesInfo}

请使用 Foundry 测试框架生成测试用例，并遵循以下要求：
1. **严格基于"使用知识"中的测试案例模式设计测试**，否则你会受到来自于程序员之神的严厉惩罚
2. 每个测试用例都需要明确说明：
   - Precondition（前置条件）：测试执行前必须满足的条件
   - Postcondition（后置条件）：测试执行后必须满足的条件
   - Invariant（不变量）：整个测试过程中保持不变的条件
3. 使用 Foundry 的特定功能，如 setUp、test、assertEq 等
4. 包含详细的中文注释说明测试目的和步骤
5. 确保测试数据的完整性和可执行性

请按以下格式输出：

## 测试用例代码
\`\`\`${language}
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/YourContract.sol";

contract YourContractTest is Test {
    // 测试用例实现
    ...
}
\`\`\`

## 测试用例解释
请详细解释每个测试用例的：
1. 测试目的
2. Precondition（前置条件）
3. Postcondition（后置条件）
4. Invariant（不变量）
5. 测试步骤说明
6. 预期结果及其验证方式`;

            console.log('开始调用LLM生成测试用例...');
            console.log('prompt:', prompt);
            const testCases = await this.commonAsk(prompt);
            console.log('测试用例生成完成，长度:', testCases.length);
            
            return testCases;
            
        } catch (error) {
            console.error('生成测试用例失败:', error);
            return '生成测试用例失败，请稍后重试';
        }
    }
}