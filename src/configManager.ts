import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 尝试加载.env文件
try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    }
} catch (error) {
    console.error('加载.env文件失败:', error);
}

export interface ApiConfig {
    openaiApiBase: string;
    openaiApiKey: string;
    pineconeApiKey: string;
    pineconeHost: string;
    pineconeNamespace: string;
}

export class ConfigManager {
    private static readonly CONFIG_SECTION = 'codeAuditHinter';
    private static readonly DEFAULT_CONFIG: ApiConfig = {
        openaiApiBase: process.env.DEFAULT_OPENAI_API_BASE || '4.0.wokaaaaai.com',
        openaiApiKey: process.env.DEFAULT_OPENAI_API_KEY || '',
        pineconeApiKey: process.env.DEFAULT_PINECONE_API_KEY || '',
        pineconeHost: process.env.DEFAULT_PINECONE_HOST || '',
        pineconeNamespace: process.env.DEFAULT_PINECONE_NAMESPACE || 'vulns_high'
    };

    // 获取配置
    public static getConfig(): ApiConfig {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        
        return {
            openaiApiBase: config.get<string>('openaiApiBase') || this.DEFAULT_CONFIG.openaiApiBase,
            openaiApiKey: config.get<string>('openaiApiKey') || this.DEFAULT_CONFIG.openaiApiKey,
            pineconeApiKey: this.DEFAULT_CONFIG.pineconeApiKey,
            pineconeHost: this.DEFAULT_CONFIG.pineconeHost,
            pineconeNamespace: this.DEFAULT_CONFIG.pineconeNamespace
        };
    }

    // 更新配置
    public static async updateConfig(newConfig: Partial<ApiConfig>): Promise<void> {
        const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
        
        for (const [key, value] of Object.entries(newConfig)) {
            if (value !== undefined) {
                await config.update(key, value, vscode.ConfigurationTarget.Global);
            }
        }
    }

    // 保存敏感配置到.env文件
    private static async saveToEnvFile(config: Partial<ApiConfig>): Promise<void> {
        try {
            const envPath = path.join(__dirname, '..', '.env');
            let envContent = '';
            
            // 如果文件存在，先读取现有内容
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }
            
            // 更新环境变量
            if (config.openaiApiBase) {
                envContent = this.updateEnvVariable(envContent, 'DEFAULT_OPENAI_API_BASE', config.openaiApiBase);
            }
            if (config.openaiApiKey) {
                envContent = this.updateEnvVariable(envContent, 'DEFAULT_OPENAI_API_KEY', config.openaiApiKey);
            }
            if (config.pineconeApiKey) {
                envContent = this.updateEnvVariable(envContent, 'DEFAULT_PINECONE_API_KEY', config.pineconeApiKey);
            }
            if (config.pineconeHost) {
                envContent = this.updateEnvVariable(envContent, 'DEFAULT_PINECONE_HOST', config.pineconeHost);
            }
            if (config.pineconeNamespace) {
                envContent = this.updateEnvVariable(envContent, 'DEFAULT_PINECONE_NAMESPACE', config.pineconeNamespace);
            }
            
            // 写入文件
            fs.writeFileSync(envPath, envContent);
            console.log('.env文件已更新');
        } catch (error) {
            console.error('保存.env文件失败:', error);
            throw error;
        }
    }
    
    // 更新环境变量
    private static updateEnvVariable(content: string, key: string, value: string): string {
        const regex = new RegExp(`^${key}=.*`, 'm');
        const newLine = `${key}=${value}`;
        
        if (regex.test(content)) {
            // 更新现有变量
            return content.replace(regex, newLine);
        } else {
            // 添加新变量
            return content + (content.endsWith('\n') ? '' : '\n') + newLine + '\n';
        }
    }

    // 打开配置界面
    public static async showConfigurationUI(): Promise<void> {
        const currentConfig = this.getConfig();
        
        // 询问用户是使用默认配置还是自定义配置
        const configChoice = await vscode.window.showQuickPick(
            [
                { label: '使用默认配置', description: '使用内置的API配置' },
                { label: '自定义配置', description: '设置自己的OpenAI API配置' }
            ],
            { placeHolder: '请选择配置方式' }
        );
        
        if (!configChoice) return; // 用户取消
        
        if (configChoice.label === '使用默认配置') {
            // 使用默认配置
            await this.updateConfig({
                openaiApiBase: this.DEFAULT_CONFIG.openaiApiBase,
                openaiApiKey: this.DEFAULT_CONFIG.openaiApiKey
            });
            
            // 设置环境变量
            process.env.OPENAI_API_BASE = this.DEFAULT_CONFIG.openaiApiBase;
            process.env.OPENAI_API_KEY = this.DEFAULT_CONFIG.openaiApiKey;
            
            vscode.window.showInformationMessage('已恢复默认配置');
            return;
        }
        
        // 获取OpenAI API Base
        const openaiApiBase = await vscode.window.showInputBox({
            prompt: 'OpenAI API 基础URL',
            value: currentConfig.openaiApiBase,
            placeHolder: '例如: 4.0.wokaai.com 或 api.openai.com'
        });
        
        if (openaiApiBase === undefined) return; // 用户取消
        
        // 获取OpenAI API Key
        const openaiApiKey = await vscode.window.showInputBox({
            prompt: 'OpenAI API 密钥',
            value: currentConfig.openaiApiKey,
            placeHolder: '以sk-开头的API密钥',
            password: true
        });
        
        if (openaiApiKey === undefined) return; // 用户取消
        
        // 更新配置
        await this.updateConfig({
            openaiApiBase,
            openaiApiKey
        });
        
        // 保存到.env文件
        await this.saveToEnvFile({
            openaiApiBase,
            openaiApiKey
        });
        
        // 设置环境变量
        process.env.OPENAI_API_BASE = openaiApiBase;
        process.env.OPENAI_API_KEY = openaiApiKey;
        
        vscode.window.showInformationMessage('配置已更新');
    }
}