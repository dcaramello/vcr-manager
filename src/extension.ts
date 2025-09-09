// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

// Regex to detect vcr/vhs/pytest.mark.vcr decorators and use_cassette
const DECORATOR_REGEXES = [
	/@(vcr|vhs)[^\n]*use_cassette\s*\(\s*['"](.+?)['"]\s*\)/, // chemin explicite
	/@(vcr|vhs)[^\n]*use_cassette\s*\(\s*\)/, // sans chemin
	/@pytest\.mark\.vcr\s*\(\s*['"](.+?)['"]\s*\)/, // chemin explicite
	/@pytest\.mark\.vcr\s*\(\s*\)/ // sans chemin
];

/**
 * Returns the directory containing manage.py in the workspace, or workspace root if not found.
 */
async function getManagePyDir(): Promise<string> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return '';
	}
	const workspaceRoot = workspaceFolders[0].uri.fsPath;
	const managePyPath = path.join(workspaceRoot, 'manage.py');
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(managePyPath));
		return workspaceRoot;
	} catch {
		// manage.py not found at root, search recursively
		const files = await vscode.workspace.findFiles('**/manage.py', null, 1);
		if (files.length > 0) {
			return path.dirname(files[0].fsPath);
		}
		return workspaceRoot;
	}
}

/**
 * Provides CodeLens actions (Show/Delete) above tests using the @vhs.use_cassette decorator.
 * Detects the decorator and extracts the cassette path for further actions.
 */
class CassetteCodeLensProvider implements vscode.CodeLensProvider {
  /**
   * Scans the document for @vhs.use_cassette decorators and returns CodeLens actions for each.
   * @param document The text document to scan.
   * @param token Cancellation token.
   * @returns Array of CodeLens objects for each detected decorator.
   */
				async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
					const codeLenses: vscode.CodeLens[] = [];
					const cassetteRoot = vscode.workspace.getConfiguration('vcrManager').get<string>('cassetteRoot');
						if (!cassetteRoot || cassetteRoot.trim() === '') {
							// If cassetteRoot is not set, do not show any buttons
							return codeLenses;
						}
					const managePyDir = await getManagePyDir();
					const lines = document.getText().split('\n');
							const fileName = path.basename(document.uri.fsPath, '.py');
							let pendingDecorator: { line: number, match: RegExpMatchArray } | null = null;
							for (let i = 0; i < lines.length; i++) {
								// Check for decorator
								for (const regex of DECORATOR_REGEXES) {
									const match = lines[i].match(regex);
									if (match) {
										pendingDecorator = { line: i, match };
										break;
									}
								}
								// If a decorator was found, look for the next function definition
								if (pendingDecorator) {
									const funcMatch = lines[i].match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/);
									if (funcMatch) {
										const testName = funcMatch[1];
										let cassettePath = '';
										const match = pendingDecorator.match;
										// If explicit path in decorator
										if (match[2] || match[1]) {
											cassettePath = match[2] || match[1];
										} else {
											// Automatic generation: file name/test name.yaml
											cassettePath = `${fileName}/${testName}.yaml`;
										}
										const range = new vscode.Range(pendingDecorator.line, 0, pendingDecorator.line, lines[pendingDecorator.line].length);
										codeLenses.push(new vscode.CodeLens(range, {
											title: '📼 Show cassette',
											command: 'vcr-manager.showCassette',
											arguments: [cassettePath, cassetteRoot, managePyDir, document.uri]
										}));
										codeLenses.push(new vscode.CodeLens(range, {
											title: '📼 Delete cassette',
											command: 'vcr-manager.deleteCassette',
											arguments: [cassettePath, cassetteRoot, managePyDir, document.uri]
										}));
										pendingDecorator = null;
									}
								}
							}
							return codeLenses;
						}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	/**
	 * Command to set the root path for VHS cassettes via an input box.
	 */
	context.subscriptions.push(vscode.commands.registerCommand('vcr.root', async () => {
		const value = await vscode.window.showInputBox({
			prompt: 'Enter the root path for VHS cassettes',
			value: vscode.workspace.getConfiguration('vcrManager').get<string>('cassetteRoot') || ''
		});
		if (value !== undefined) {
			await vscode.workspace.getConfiguration('vcrManager').update('cassetteRoot', value, vscode.ConfigurationTarget.Workspace);
			vscode.window.showInformationMessage(`Cassette root path set to: ${value}`);
		}
	}));
	/**
	 * Called when the extension is activated. Registers commands and the CodeLens provider.
	 * @param context The extension context provided by VS Code.
	 */

	console.log('Congratulations, your extension "vcr-manager" is now active!');

	// Commande pour afficher la cassette
	context.subscriptions.push(vscode.commands.registerCommand('vcr-manager.showCassette', async (cassettePath: string, cassetteRoot?: string, managePyDir?: string) => {
	/**
	 * Command to show the cassette file in the editor.
	 * @param cassettePath Relative path to the cassette file from the decorator.
	 */
		// Utilise managePyDir comme racine, puis cassetteRoot, puis cassettePath
		const rootDir = managePyDir || (await getManagePyDir());
		const cassetteDir = cassetteRoot || vscode.workspace.getConfiguration('vcrManager').get<string>('cassetteRoot') || '';
		const fullPath = vscode.Uri.file(path.join(rootDir, cassetteDir, cassettePath));
		try {
			await vscode.window.showTextDocument(fullPath);
		} catch (err) {
			vscode.window.showErrorMessage(`Cassette introuvable: ${fullPath.fsPath}`);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('vcr-manager.deleteCassette', async (cassettePath: string, cassetteRoot?: string, managePyDir?: string) => {
	/**
	 * Command to delete the cassette file from disk.
	 * @param cassettePath Relative path to the cassette file from the decorator.
	 */
		// Utilise managePyDir comme racine, puis cassetteRoot, puis cassettePath
		const rootDir = managePyDir || (await getManagePyDir());
		const cassetteDir = cassetteRoot || vscode.workspace.getConfiguration('vcrManager').get<string>('cassetteRoot') || '';
		const fullPath = vscode.Uri.file(path.join(rootDir, cassetteDir, cassettePath));
		try {
			await vscode.workspace.fs.delete(fullPath);
			vscode.window.showInformationMessage(`Cassette supprimée: ${fullPath.fsPath}`);
		} catch (err) {
			vscode.window.showErrorMessage(`Impossible de supprimer la cassette: ${fullPath.fsPath}`);
		}
	}));

	context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: 'python' }, new CassetteCodeLensProvider()));
}

// This method is called when your extension is deactivated
export function deactivate() {}
