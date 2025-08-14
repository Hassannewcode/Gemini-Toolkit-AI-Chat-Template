import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chat, SandboxFile } from '../types';
import { XMarkIcon, CodeBracketIcon, EyeIcon, TerminalIcon, PlayIcon, BoltIcon, FolderIcon, FileIcon, ChevronRightIcon, ChevronDownIcon, PlusIcon, PencilIcon, TrashIcon, RefreshIcon } from './icons';

type SandboxProps = {
  sandboxState: NonNullable<Chat['sandboxState']>;
  onClose: () => void;
  onUpdate: (updater: (prevState: Chat['sandboxState']) => Chat['sandboxState']) => void;
  onAutoFixRequest: (error: string, code: string, language: string) => void;
};

type ActiveView = 'editor' | 'preview' | 'console';

// --- File Explorer ---
type TreeNode = { [key: string]: TreeNode | SandboxFile };

const FileExplorer: React.FC<{ 
    files: { [path: string]: SandboxFile },
    activeFile: string | null,
    onSelectFile: (path: string) => void,
    onUpdate: SandboxProps['onUpdate']
}> = ({ files, activeFile, onSelectFile, onUpdate }) => {
    
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(['/']));

    const fileTree = useMemo(() => {
        const tree: TreeNode = {};
        Object.keys(files).sort().forEach(path => {
            let currentLevel = tree;
            const parts = path.split('/');
            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    currentLevel[part] = files[path];
                } else {
                    if (!currentLevel[part]) {
                        currentLevel[part] = {};
                    }
                    currentLevel = currentLevel[part] as TreeNode;
                }
            });
        });
        return tree;
    }, [files]);
    
    useEffect(() => {
        // Automatically open the folder of the active file
        if (activeFile) {
            const pathParts = activeFile.split('/');
            if (pathParts.length > 1) {
                const folderPath = pathParts.slice(0, -1).join('/');
                setOpenFolders(prev => new Set(prev).add(folderPath));
            }
        }
    }, [activeFile]);

    const toggleFolder = (path: string) => {
        setOpenFolders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(path)) {
                newSet.delete(path);
            } else {
                newSet.add(path);
            }
            return newSet;
        });
    };
    
    const handleNewFile = () => {
        const name = prompt("Enter new file name (e.g., 'src/new.js'):");
        if (!name) return;
        onUpdate(prev => ({
            ...prev,
            files: { ...prev.files, [name]: { code: '', language: name.split('.').pop() || 'text' } },
            openFiles: [...prev.openFiles, name],
            activeFile: name,
        }));
    };

    const renderTree = (node: TreeNode, path: string = ''): React.ReactNode[] => {
        return Object.entries(node).map(([name, content]) => {
            const currentPath = path ? `${path}/${name}` : name;
            const isFolder = !('code' in content);
            const indent = path.split('/').filter(p => p).length;

            if (isFolder) {
                const isOpen = openFolders.has(currentPath);
                return (
                    <div key={currentPath}>
                        <button onClick={() => toggleFolder(currentPath)} className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-sm text-text-secondary hover:bg-surface/50 rounded-md">
                            <span style={{ paddingLeft: `${indent * 1}rem` }}/>
                            {isOpen ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRightIcon className="w-4 h-4" />}
                            <FolderIcon className="w-5 h-5 text-yellow-500/80" />
                            <span>{name}</span>
                        </button>
                        {isOpen && <div className="pl-2">{renderTree(content, currentPath)}</div>}
                    </div>
                );
            } else {
                return (
                    <button 
                        key={currentPath} 
                        onClick={() => onSelectFile(currentPath)} 
                        data-context-menu-id="sandbox-file"
                        data-path={currentPath}
                        className={`w-full flex items-center gap-2 text-left px-2 py-1.5 text-sm rounded-md transition-colors ${activeFile === currentPath ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-surface/50 hover:text-text-primary'}`}
                    >
                        <span style={{ paddingLeft: `${indent * 1}rem` }}/>
                        <FileIcon className="w-5 h-5 text-gray-400/80 ml-4" />
                        <span className="truncate">{name}</span>
                    </button>
                );
            }
        });
    };

    return (
        <div className="w-56 bg-surface flex flex-col h-full border-r border-border">
            <div className="p-2 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold px-2">Explorer</h2>
                <button onClick={handleNewFile} title="New File" className="p-1.5 rounded-md hover:bg-accent-hover"><PlusIcon className="w-4 h-4"/></button>
            </div>
            <div className="flex-1 p-1 overflow-y-auto">
                {renderTree(fileTree)}
            </div>
        </div>
    );
};

// --- Preview Component ---
const Preview: React.FC<{ code: string; language: string; onConsoleUpdate: (line: { type: string, message: string }) => void }> = ({ code, language, onConsoleUpdate }) => {
    const [srcDoc, setSrcDoc] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);

    const consoleInterceptor = `
        const formatArg = (arg) => {
            if (arg instanceof Error) { return \`Error: \${arg.message}\\n\${arg.stack}\`; }
            if (typeof arg === 'object' && arg !== null) { try { return JSON.stringify(arg, null, 2); } catch (e) { return String(arg); } }
            return String(arg);
        };
        const postMsg = (type, args) => {
            const payload = args.map(formatArg).join(' ');
            window.parent.postMessage({ source: 'preview-iframe', type, payload }, '*');
        };
        ['log', 'warn', 'error'].forEach(type => {
            const original = console[type];
            console[type] = (...args) => { postMsg(type, args); original.apply(console, args); };
        });
        window.addEventListener('error', e => postMsg('error', [e.message]));
        window.addEventListener('unhandledrejection', e => postMsg('error', ['Unhandled Promise Rejection:', e.reason]));
    `;
    
    const buildSrcDoc = useCallback((htmlCode: string, cssCode: string, jsCode: string) => {
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <style>${cssCode}</style>
                    <style>body { font-family: sans-serif; margin: 0; background-color: white; color: black; }</style>
                    <script type="importmap">
                    {
                      "imports": {
                        "react": "https://esm.sh/react@18.2.0",
                        "react-dom/client": "https://esm.sh/react-dom@18.2.0/client"
                      }
                    }
                    </script>
                </head>
                <body>
                    ${htmlCode.includes('<div id="root"></div>') ? htmlCode : `<div id="root"></div>${htmlCode}`}
                    <script type="module">
                        (function() { ${consoleInterceptor}; ${jsCode}; })();
                    </script>
                </body>
            </html>`;
    }, [consoleInterceptor]);

    useEffect(() => {
        const handler = setTimeout(() => {
            let finalSrcDoc = 'Unsupported file type for preview.';
            if (language === 'html') {
                finalSrcDoc = buildSrcDoc(code, '', '');
            } else if (language === 'jsx' || language === 'javascript') {
                const jsCode = language === 'jsx' ?
                    `
                    import React from 'react';
                    import ReactDOM from 'react-dom/client';
                    ${code}
                    const container = document.getElementById('root');
                    const Component = ${code.match(/export\s+default\s+function\s+(\w+)/)?.[1] || code.match(/const\s+([A-Z]\w*)\s*=/)?.[1] || 'App'};
                    if(container && Component) {
                        const root = ReactDOM.createRoot(container);
                        root.render(<Component />);
                    }
                    ` : code;
                 finalSrcDoc = buildSrcDoc('<div id="root"></div>', '', jsCode);
            }
            setSrcDoc(finalSrcDoc);
        }, 250);
        return () => clearTimeout(handler);
    }, [code, language, buildSrcDoc, refreshKey]);

    useEffect(() => {
        const handleIframeMessages = (event: MessageEvent) => {
            if (event.data?.source === 'preview-iframe') {
                onConsoleUpdate({ type: event.data.type, message: `[PREVIEW] ${event.data.payload}` });
            }
        };
        window.addEventListener('message', handleIframeMessages);
        return () => window.removeEventListener('message', handleIframeMessages);
    }, [onConsoleUpdate]);

    return (
        <div className="w-full h-full flex flex-col bg-background">
             <div className="flex items-center p-1.5 border-b border-border flex-shrink-0">
                <div className="flex-grow" />
                <button onClick={() => setRefreshKey(k => k + 1)} className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors"><RefreshIcon className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 bg-black/20 p-4">
                <iframe key={refreshKey} srcDoc={srcDoc} title="Preview" sandbox="allow-scripts allow-modals allow-same-origin" className="w-full h-full border-0 bg-white rounded-md shadow-lg" />
            </div>
        </div>
    );
};

// --- Main Sandbox ---
export const Sandbox: React.FC<SandboxProps> = ({ sandboxState, onClose, onUpdate, onAutoFixRequest }) => {
    const { files, openFiles, activeFile, consoleOutput } = sandboxState;
    const [activeView, setActiveView] = useState<ActiveView>('editor');

    const activeSandboxFile = activeFile ? files[activeFile] : null;

    const handleSelectFile = (path: string) => {
        onUpdate(prev => {
            const newOpenFiles = prev.openFiles.includes(path) ? prev.openFiles : [...prev.openFiles, path];
            return { ...prev, activeFile: path, openFiles: newOpenFiles };
        });
        setActiveView('editor');
    };

    const handleCloseTab = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onUpdate(prev => {
            const newOpenFiles = prev.openFiles.filter(p => p !== path);
            let newActiveFile = prev.activeFile;
            if (prev.activeFile === path) {
                const closingIdx = prev.openFiles.indexOf(path);
                newActiveFile = newOpenFiles[closingIdx] || newOpenFiles[closingIdx - 1] || null;
            }
            return { ...prev, openFiles: newOpenFiles, activeFile: newActiveFile };
        });
    };

    const handleCodeChange = (newCode: string) => {
        if (activeFile) {
            onUpdate(prev => ({
                ...prev,
                files: { ...prev.files, [activeFile]: { ...prev.files[activeFile], code: newCode } }
            }));
        }
    };

    const handleConsoleUpdate = (line: { type: string, message: string }) => {
        onUpdate(prev => ({ ...prev, consoleOutput: [...(prev.consoleOutput || []), line] }));
        setActiveView('console');
    };

    const handleClearConsole = () => onUpdate(prev => ({ ...prev, consoleOutput: [] }));

    const TabButton: React.FC<{ view: ActiveView, children: React.ReactNode, disabled?: boolean }> = ({ view, children, disabled }) => (
        <button onClick={() => setActiveView(view)} disabled={disabled} data-active={activeView === view} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed border-b-2 data-[active=true]:border-accent data-[active=true]:text-text-primary border-transparent text-text-secondary hover:text-text-primary`}>
          {children}
        </button>
    );
    
    const isPreviewable = useMemo(() => {
        if (!activeSandboxFile) return false;
        return ['html', 'jsx', 'javascript'].includes(activeSandboxFile.language);
    }, [activeSandboxFile]);

    return (
        <div className="flex w-full h-full bg-background border-l border-border">
            <FileExplorer files={files} activeFile={activeFile} onSelectFile={handleSelectFile} onUpdate={onUpdate} />
            <div className="flex-1 flex flex-col min-w-0">
                <header className="flex items-center justify-between pl-4 pr-2 h-12 border-b border-border flex-shrink-0">
                    <h2 className="text-sm font-semibold">{activeFile || 'Sandbox'}</h2>
                    <button onClick={onClose} className="p-2 rounded-md text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </header>
                
                {/* Editor Tabs */}
                <div className="flex items-end border-b border-border bg-surface/30 h-10 overflow-x-auto flex-shrink-0">
                    {openFiles.map(path => (
                        <button key={path} onClick={() => handleSelectFile(path)} className={`flex items-center gap-2 pl-4 pr-2 h-full text-sm border-r border-border transition-colors ${activeFile === path ? 'bg-background text-text-primary' : 'text-text-secondary hover:bg-surface'}`}>
                            <span className="truncate max-w-xs">{path.split('/').pop()}</span>
                            <span onClick={(e) => handleCloseTab(path, e)} className="p-1 rounded-full hover:bg-accent-hover"><XMarkIcon className="w-3.5 h-3.5"/></span>
                        </button>
                    ))}
                </div>

                <div className="flex-1 flex flex-col bg-background overflow-auto">
                    {activeSandboxFile ? (
                        <>
                            <nav className="flex items-stretch px-2 border-b border-border bg-surface/50">
                                <TabButton view="editor"><CodeBracketIcon className="w-4 h-4"/> Editor</TabButton>
                                <TabButton view="preview" disabled={!isPreviewable}><EyeIcon className="w-4 h-4"/> Preview</TabButton>
                                <TabButton view="console"><TerminalIcon className="w-4 h-4"/> Console</TabButton>
                            </nav>
                            <main className="flex-1 bg-background overflow-auto">
                                {activeView === 'editor' && (
                                    <textarea value={activeSandboxFile.code} onChange={(e) => handleCodeChange(e.target.value)} className="w-full h-full bg-transparent text-text-primary p-4 resize-none font-mono text-sm leading-6 focus:outline-none" spellCheck="false"/>
                                )}
                                {activeView === 'preview' && isPreviewable && (
                                    <Preview code={activeSandboxFile.code} language={activeSandboxFile.language} onConsoleUpdate={handleConsoleUpdate} />
                                )}
                                {activeView === 'console' && (
                                     <div data-context-menu-id="preview-console" className="w-full h-full p-4 font-mono text-xs text-text-secondary overflow-y-auto">
                                        {consoleOutput && consoleOutput.map((line, index) => (
                                            <div key={index} className="group flex items-start gap-2 justify-between hover:bg-surface/50 -mx-4 px-4 py-0.5 rounded-md">
                                              <pre className={`whitespace-pre-wrap flex-1 ${line.type === 'error' ? 'text-red-400' : line.type === 'info' ? 'text-blue-300' : ''}`}>
                                                  <span className="select-none text-text-tertiary mr-2">{'>'}</span>{line.message}
                                              </pre>
                                              {line.type === 'error' && (
                                                  <button
                                                      onClick={() => onAutoFixRequest(line.message, activeSandboxFile.code, activeSandboxFile.language)}
                                                      className="flex items-center gap-1.5 text-xs text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/10 rounded-md px-2 py-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-yellow-400/20 hover:text-yellow-300"
                                                      title="Ask AI to fix this error"
                                                  >
                                                      <BoltIcon className="w-3 h-3" />
                                                      Auto-Fix
                                                  </button>
                                              )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </main>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center text-text-secondary">
                           <CodeBracketIcon className="w-16 h-16 mb-4 opacity-20"/>
                           <p>No file selected</p>
                           <p className="text-sm text-text-tertiary">Select a file from the explorer to begin editing.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
