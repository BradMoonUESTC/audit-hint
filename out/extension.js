"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const ragService_1 = require("./ragService");
const vulnerabilityPanel_1 = require("./vulnerabilityPanel");
const configManager_1 = require("./configManager");
let vulnerabilityPanel;
let ragService;
function activate(context) {
    console.log('代码漏洞检测器已激活');
    // 初始化RAG服务
    ragService = new ragService_1.RagService();
    // 注册打开漏洞分析面板的命令
    const openPanelCommand = vscode.commands.registerCommand('vulnerability-detector.openVulnerabilityPanel', () => {
        if (!vulnerabilityPanel) {
            vulnerabilityPanel = new vulnerabilityPanel_1.VulnerabilityPanel(context.extensionUri, ragService);
        }
        vulnerabilityPanel.reveal();
    });
    // 注册配置命令
    const openConfigCommand = vscode.commands.registerCommand('vulnerability-detector.openConfiguration', async () => {
        await configManager_1.ConfigManager.showConfigurationUI();
        // 更新RAG服务配置
        ragService.updateConfig(configManager_1.ConfigManager.getConfig());
    });
    // 注册右键菜单命令：分析选中的代码
    const analyzeSelectionCommand = vscode.commands.registerCommand('vulnerability-detector.analyzeSelectedCode', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有打开的编辑器');
            return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('请先选择一段代码');
            return;
        }
        const selectedText = editor.document.getText(selection);
        const language = editor.document.languageId;
        // 打开面板并分析选中的代码
        if (!vulnerabilityPanel) {
            vulnerabilityPanel = new vulnerabilityPanel_1.VulnerabilityPanel(context.extensionUri, ragService);
        }
        vulnerabilityPanel.reveal();
        vulnerabilityPanel.analyzeCode(selectedText, language);
    });
    // 注册右键菜单命令
    context.subscriptions.push(vscode.commands.registerCommand('vulnerability-analyzer.analyzeSelectedCode', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有打开的编辑器');
            return;
        }
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showErrorMessage('请先选择代码');
            return;
        }
        // 创建或显示漏洞分析面板
        const panel = vulnerabilityPanel_1.VulnerabilityPanel.createOrShow(context.extensionUri, ragService);
        // 设置代码并分析
        panel.setCodeAndAnalyze(selectedText);
    }));
    // 注册面板关闭时的处理
    if (vulnerabilityPanel) {
        context.subscriptions.push(vulnerabilityPanel.onDidDispose(() => {
            vulnerabilityPanel = undefined;
        }));
    }
    // 注册生成测试用例的命令
    const generateTestCommand = vscode.commands.registerCommand('vulnerability-detector.generateTestCase', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('没有打开的编辑器');
            return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('请先选择一段代码');
            return;
        }
        const selectedText = editor.document.getText(selection);
        const language = editor.document.languageId;
        // 打开面板并生成测试用例
        if (!vulnerabilityPanel) {
            vulnerabilityPanel = new vulnerabilityPanel_1.VulnerabilityPanel(context.extensionUri, ragService);
        }
        vulnerabilityPanel.reveal();
        vulnerabilityPanel.generateTestCases(selectedText, language);
    });
    context.subscriptions.push(openPanelCommand, analyzeSelectionCommand, openConfigCommand, generateTestCommand);
}
exports.activate = activate;
function deactivate() {
    console.log('代码漏洞检测器已停用');
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map