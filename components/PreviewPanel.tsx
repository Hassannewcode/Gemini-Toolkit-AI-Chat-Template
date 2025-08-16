import React, { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { Chat, SandboxFile } from '../types';
import { XMarkIcon, CodeBracketIcon, EyeIcon, TerminalIcon, PlayIcon, BoltIcon, FolderIcon, FileIcon, ChevronRightIcon, ChevronDownIcon, PlusIcon, RefreshIcon, TrashIcon, ExpandIcon, CollapseIcon, DevicePhoneMobileIcon, DeviceTabletIcon, ComputerDesktopIcon, StopIcon, EllipsisVerticalIcon, CheckIcon } from './icons';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Editor from '@monaco-editor/react';

type SandboxProps = {
  sandboxState: NonNullable<Chat['sandboxState']>;
  onClose: () => void;
  onUpdate: (updater: (prevState: Chat['sandboxState']) => Chat['sandboxState']) => void;
  onAutoFixRequest: (error: string) => void;
};

type ProjectType = 'python' | 'node' | 'web' | 'unknown';

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
        if (activeFile) {
            const pathParts = activeFile.split('/');
            if (pathParts.length > 1) {
                let cumulativePath = '';
                for (let i = 0; i < pathParts.length - 1; i++) {
                    cumulativePath = cumulativePath ? `${cumulativePath}/${pathParts[i]}` : pathParts[i];
                    setOpenFolders(prev => new Set(prev).add(cumulativePath));
                }
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
        if (!name || !name.trim()) return;
        onUpdate(prev => ({
            ...prev!,
            files: { ...prev!.files, [name]: { code: '', language: name.split('.').pop() || 'text' } },
            openFiles: [...prev!.openFiles, name],
            activeFile: name,
        }));
    };

    const renderTree = (node: TreeNode, path: string = ''): React.ReactNode[] => {
        return Object.entries(node).map(([name, content]) => {
            const currentPath = path ? `${path}/${name}` : name;
            const isFolder = !('code' in content);

            if (isFolder) {
                const isOpen = openFolders.has(currentPath);
                return (
                    <div key={currentPath}>
                        <button onClick={() => toggleFolder(currentPath)} className="w-full flex items-center gap-1 text-left px-2 py-1.5 text-sm text-text-secondary hover:bg-surface/50 rounded-md">
                            {isOpen ? <ChevronDownIcon className="w-4 h-4 flex-shrink-0" /> : <ChevronRightIcon className="w-4 h-4 flex-shrink-0" />}
                            <FolderIcon className="w-5 h-5 text-text-tertiary" />
                            <span className="truncate">{name}</span>
                        </button>
                        {isOpen && <div className="pl-3 border-l border-border/50 ml-3">{renderTree(content, currentPath)}</div>}
                    </div>
                );
            } else {
                return (
                    <button 
                        key={currentPath} 
                        onClick={() => onSelectFile(currentPath)} 
                        data-context-menu-id="sandbox-file"
                        data-path={currentPath}
                        className={`w-full flex items-center gap-2 text-left pr-2 py-1.5 text-sm rounded-md transition-colors pl-3 ${activeFile === currentPath ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-surface/50 hover:text-text-primary'}`}
                    >
                        <span className="w-4 h-4 flex-shrink-0 ml-3" />
                        <FileIcon className="w-5 h-5 text-gray-400/80" />
                        <span className="truncate">{name}</span>
                    </button>
                );
            }
        });
    };

    return (
        <div className="w-full bg-surface flex flex-col h-full">
            <div className="p-2 border-b border-border flex items-center justify-between flex-shrink-0 h-12">
                <h2 className="text-sm font-semibold px-2">Explorer</h2>
                <button onClick={handleNewFile} title="New File" className="p-1.5 rounded-md hover:bg-accent-hover"><PlusIcon className="w-4 h-4"/></button>
            </div>
            <div className="flex-1 p-1 overflow-y-auto">
                {renderTree(fileTree)}
            </div>
        </div>
    );
};

const resolvePath = (base: string, relative: string): string => {
    const stack = base.split('/').filter(i => i);
    // if relative path starts with '/', it's from the root.
    if (relative.startsWith('/')) {
        stack.length = 0;
    } else {
      // It's relative, so pop the filename from the base path.
      stack.pop();
    }

    relative.split('/').forEach(part => {
        if (part === '.' || part === '') return;
        if (part === '..') {
            stack.pop();
        } else {
            stack.push(part);
        }
    });
    return stack.join('/');
};


const interceptorScript = `
    const formatArg = (arg) => {
        if (arg instanceof Error) { return \`Error: \${arg.message}\\n\${arg.stack}\`; }
        if (typeof arg === 'object' && arg !== null) { try { return JSON.stringify(arg, null, 2); } catch (e) { return String(arg); } }
        return String(arg);
    };
    const postConsoleMsg = (type, args) => {
        const payload = args.map(formatArg).join(' ');
        window.parent.postMessage({ source: 'preview-console', type, payload }, '*');
    };
    ['log', 'warn', 'error'].forEach(type => {
        const original = console[type];
        console[type] = (...args) => { postConsoleMsg(type, args); original.apply(console, args); };
    });
    window.addEventListener('error', e => postConsoleMsg('error', [e.message]));
    window.addEventListener('unhandledrejection', e => postConsoleMsg('error', ['Unhandled Promise Rejection:', e.reason]));

    // --- Fetch Interceptor ---
    const RealFetch = window.fetch;
    const fetchPromises = {};
    let fetchCounter = 0;

    window.addEventListener('message', (event) => {
        if (event.data?.source === 'sandbox-response') {
            const { id, response, error } = event.data;
            if (fetchPromises[id]) {
                if (error) {
                    fetchPromises[id].reject(new Error(error));
                } else {
                    const res = new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers
                    });
                    fetchPromises[id].resolve(res);
                }
                delete fetchPromises[id];
            }
        }
    });

    window.fetch = async (resource, options) => {
        const url = resource instanceof Request ? resource.url : resource;
        const fullUrl = new URL(url, window.location.href);

        if (fullUrl.origin === window.location.origin) {
            const id = fetchCounter++;
            const body = options?.body;
            let serializedBody = body;
            if (body instanceof Blob) {
                serializedBody = await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(body);
                });
            }

            return new Promise((resolve, reject) => {
                fetchPromises[id] = { resolve, reject };
                window.parent.postMessage({
                    source: 'preview-request',
                    id,
                    request: {
                        url: fullUrl.pathname + fullUrl.search,
                        method: options?.method || 'GET',
                        headers: options?.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {},
                        body: serializedBody
                    }
                }, '*');
            });
        }
        return RealFetch(resource, options);
    };
`;

// --- PreviewView Component for Web Projects ---
type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const PreviewView: React.FC<{
    files: { [path: string]: SandboxFile };
    onUpdate: SandboxProps['onUpdate'];
    iframeRef: React.RefObject<HTMLIFrameElement>;
}> = ({ files, onUpdate, iframeRef }) => {
    const [srcDoc, setSrcDoc] = useState('');
    const [refreshKey, setRefreshKey] = useState(0);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');

    const deviceDimensions: { [key in DeviceMode]: { width: string; height: string } } = {
        desktop: { width: '100%', height: '100%' },
        tablet: { width: '768px', height: '1024px' },
        mobile: { width: '375px', height: '812px' },
    };

    const buildSrcDoc = useCallback((processedHtml: string) => {
        const headTag = /<head[^>]*>/i.exec(processedHtml);
        if (headTag) {
            const injectionPoint = headTag.index + headTag[0].length;
            const fullInterceptorScript = `
                <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
                <script type="importmap">
                {
                  "imports": {
                    "react": "https://esm.sh/react@18.2.0",
                    "react-dom/client": "https://esm.sh/react-dom@18.2.0/client"
                  }
                }
                </script>
                <script>${interceptorScript}</script>
            `;
            return processedHtml.slice(0, injectionPoint) + fullInterceptorScript + processedHtml.slice(injectionPoint);
        }
         return `
            <!DOCTYPE html>
            <html>
                <head>
                    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
                    <script type="importmap">{ "imports": { "react": "https://esm.sh/react@18.2.0", "react-dom/client": "https://esm.sh/react-dom@18.2.0/client" }}</script>
                    <script>${interceptorScript}</script>
                </head>
                <body>${processedHtml}</body>
            </html>`;
    }, []);

    useEffect(() => {
        const handler = setTimeout(() => {
            const indexHtmlFile = Object.entries(files).find(([path]) => path === 'index.html');
            const indexJsxFile = Object.entries(files).find(([path]) => ['index.jsx', 'index.tsx', 'main.jsx', 'main.tsx', 'App.jsx', 'App.tsx'].includes(path.split('/').pop()!));


            if (!indexHtmlFile && !indexJsxFile) {
                setSrcDoc('<html><body><div style="font-family: sans-serif; padding: 2rem; color: #94a3b8;"><h1>No entry point found</h1><p>Create an index.html, index.jsx, or App.jsx file to see a preview.</p></div></body></html>');
                return;
            }

            let htmlContent;
            let basePath;

            if (indexHtmlFile) {
                htmlContent = indexHtmlFile[1].code;
                basePath = indexHtmlFile[0];
            } else {
                basePath = indexJsxFile![0];
                htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head><title>Preview</title></head>
                    <body>
                        <div id="root"></div>
                        <script type="text/babel" src="./${basePath}"></script>
                    </body>
                    </html>
                `;
            }

            htmlContent = htmlContent.replace(/<link(?=.*\shref="([^"]+?)")[^>]*>/g, (match, href) => {
                if (!href || href.startsWith('http')) return match;
                const cssPath = resolvePath(basePath, href);
                const cssFile = files[cssPath];
                return cssFile ? `<style>${cssFile.code}</style>` : `<!-- Link to ${href} (not found at ${cssPath}) -->`;
            });
            
            htmlContent = htmlContent.replace(/<script(?=.*\ssrc="([^"]+?)")[^>]*><\/script>/g, (match, src) => {
                if (!src || src.startsWith('http')) return match;
                const jsPath = resolvePath(basePath, src);
                const jsFile = files[jsPath];
                const isBabel = jsPath.endsWith('.jsx') || jsPath.endsWith('.tsx') || match.includes('type="text/babel"');
                return jsFile ? `<script${isBabel ? ' type="text/babel"' : ''}>${jsFile.code}</script>` : `<!-- Script src ${src} (not found at ${jsPath}) -->`;
            });

            setSrcDoc(buildSrcDoc(htmlContent));
        }, 250);

        return () => clearTimeout(handler);
    }, [files, buildSrcDoc, refreshKey]);

    useEffect(() => {
        const handleIframeMessages = (event: MessageEvent) => {
            if (event.data?.source === 'preview-console') {
                onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: event.data.type, message: event.data.payload }] }));
            }
        };
        window.addEventListener('message', handleIframeMessages);
        return () => window.removeEventListener('message', handleIframeMessages);
    }, [onUpdate]);

    return (
        <div className={`w-full h-full flex flex-col bg-background ${isFullScreen ? 'fixed inset-0 z-50' : ''}`}>
            <div className="flex items-center justify-between p-1.5 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-1 bg-surface p-1 rounded-lg">
                    <button
                        onClick={() => setDeviceMode('desktop')}
                        className={`p-1.5 rounded-md transition-colors ${deviceMode === 'desktop' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-accent-hover'}`}
                        title="Desktop View"
                    >
                        <ComputerDesktopIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => setDeviceMode('tablet')}
                        className={`p-1.5 rounded-md transition-colors ${deviceMode === 'tablet' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-accent-hover'}`}
                        title="Tablet View"
                    >
                        <DeviceTabletIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => setDeviceMode('mobile')}
                        className={`p-1.5 rounded-md transition-colors ${deviceMode === 'mobile' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-accent-hover'}`}
                        title="Mobile View"
                    >
                        <DevicePhoneMobileIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex items-center">
                    <button onClick={() => setRefreshKey(k => k + 1)} title="Refresh Preview" className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors">
                        <RefreshIcon className="w-5 h-5" />
                    </button>
                     <button onClick={() => setIsFullScreen(p => !p)} title={isFullScreen ? "Exit Fullscreen" : "Enter Fullscreen"} className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors">
                        {isFullScreen ? <CollapseIcon className="w-5 h-5" /> : <ExpandIcon className="w-5 h-5" />}
                    </button>
                </div>
            </div>
            <div className="flex-1 bg-black/50 p-4 flex items-center justify-center overflow-auto">
                <div
                    className="transition-all duration-300 ease-in-out flex-shrink-0 shadow-2xl bg-surface rounded-lg"
                    style={{
                        width: deviceDimensions[deviceMode].width,
                        height: deviceMode === 'desktop' ? '100%' : deviceDimensions[deviceMode].height,
                        maxWidth: '100%',
                        maxHeight: '100%',
                    }}
                >
                    <iframe ref={iframeRef} key={refreshKey} srcDoc={srcDoc} title="Preview" sandbox="allow-scripts allow-modals allow-same-origin" className="w-full h-full border-0 bg-white rounded-md" />
                </div>
            </div>
        </div>
    );
};

// --- TerminalView Component for Python/Node execution and console output ---
type ExecutionState = { isRunning: boolean; isLoading: boolean; isPyodideReady: boolean };

interface TerminalViewProps {
    files: { [path: string]: SandboxFile };
    projectType: ProjectType;
    consoleOutput?: { type: string; message: string }[];
    onUpdate: SandboxProps['onUpdate'];
    onAutoFixRequest: SandboxProps['onAutoFixRequest'];
    onBackendReady: (isReady: boolean) => void;
    onStateChange: (state: ExecutionState) => void;
    entryPoint: string | null;
}

export type TerminalActions = {
    run: () => void;
    stop: () => void;
}

const TerminalView = forwardRef<TerminalActions, TerminalViewProps>(({ files, projectType, consoleOutput, onUpdate, onAutoFixRequest, onBackendReady, onStateChange, entryPoint }, ref) => {
    const pyodideRef = useRef<any>(null);
    const workerRef = useRef<Worker | null>(null);

    const [state, setState] = useState<ExecutionState>({
        isRunning: false,
        isLoading: false,
        isPyodideReady: false,
    });

    useEffect(() => {
        onStateChange(state);
    }, [state, onStateChange]);

    useEffect(() => {
        if (projectType !== 'python' || state.isPyodideReady || state.isLoading) return;
        async function initPyodide() {
            setState(s => ({ ...s, isLoading: true }));
            try {
                pyodideRef.current = await (window as any).loadPyodide();
                await pyodideRef.current.loadPackage(["micropip", "pyodide-http"]);
                setState(s => ({ ...s, isPyodideReady: true }));
            } catch (error) {
                console.error("Failed to load Pyodide", error);
                onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'error', message: `Failed to load Python runtime: ${error}` }] }));
            } finally {
                setState(s => ({ ...s, isLoading: false }));
            }
        }
        initPyodide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectType, state.isPyodideReady, state.isLoading]);

    useEffect(() => {
        return () => { if (workerRef.current) workerRef.current.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRun = useCallback(async () => {
        setState(s => ({ ...s, isRunning: true }));
        onBackendReady(false);
        onUpdate(p => ({ ...p!, consoleOutput: [] }));

        if (projectType === 'python') {
            if (!pyodideRef.current) {
                onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'error', message: "Python runtime is not ready." }] }));
                setState(s => ({ ...s, isRunning: false }));
                return;
            }
            const pyodide = pyodideRef.current;
            pyodide.setStdout({ batched: (msg: string) => onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'log', message: msg }] })) });
            pyodide.setStderr({ batched: (msg: string) => onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'error', message: msg }] })) });

            try {
                for (const path in files) {
                    const dir = path.substring(0, path.lastIndexOf('/'));
                    if (dir) pyodide.FS.mkdirTree(dir);
                    pyodide.FS.writeFile(path, files[path].code);
                }
                const resolvedEntryPoint = entryPoint || ['main.py', 'app.py'].find(f => f in files) || Object.keys(files).find(f => f.endsWith('.py'));
                if (resolvedEntryPoint) {
                    onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'info', message: `Running ${resolvedEntryPoint}...` }] }));
                    await pyodide.runPythonAsync(`import pyodide_http; pyodide_http.patch_all();`);
                    await pyodide.runPythonAsync(files[resolvedEntryPoint].code);
                    onBackendReady(true); // Assume server is ready after script runs
                } else throw new Error("No Python entry point found (e.g., main.py).");
            } catch (e: any) {
                onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'error', message: e.message }] }));
            } finally {
                 setState(s => ({ ...s, isRunning: false }));
            }
        } else if (projectType === 'node') {
            if (workerRef.current) workerRef.current.terminate();
            
            const workerCode = `
                const files = {};
                const moduleCache = {};
                let serverRequestHandler = null;

                const http = {
                    createServer: (handler) => {
                        serverRequestHandler = handler;
                        return {
                            listen: (port, cb) => {
                                self.postMessage({ t: 'server-ready' });
                                if (cb) cb();
                            },
                            on: () => {} // no-op for simplicity
                        };
                    }
                };

                const resolvePath = (currentPath, requestedPath) => {
                    if (!requestedPath.startsWith('.')) return requestedPath;
                    const currentDirParts = currentPath.split('/').slice(0, -1);
                    const requestedParts = requestedPath.split('/');
                    for (const part of requestedParts) {
                        if (part === '.' || part === '') continue;
                        if (part === '..') currentDirParts.pop(); else currentDirParts.push(part);
                    }
                    return currentDirParts.join('/');
                };

                const customRequire = (requestedPath, currentPath) => {
                    if (requestedPath === 'http') return http;

                    const resolvedPath = resolvePath(currentPath, requestedPath);
                    const potentialPaths = [resolvedPath, resolvedPath + '.js', resolvedPath + '/index.js'];
                    const finalPath = potentialPaths.find(p => files[p]);

                    if (!finalPath) throw new Error(\`Cannot find module '\${requestedPath}' required from \${currentPath}\`);
                    if (moduleCache[finalPath]) return moduleCache[finalPath].exports;

                    const code = files[finalPath];
                    const module = { exports: {} };
                    moduleCache[finalPath] = module;
                    const requireWithContext = (p) => customRequire(p, finalPath);
                    
                    try {
                        const wrapper = new Function('require', 'module', 'exports', '__dirname', code);
                        wrapper(requireWithContext, module, module.exports, finalPath.substring(0, finalPath.lastIndexOf('/')) || '.');
                    } catch(e) {
                        throw new Error(\`Error in module \${finalPath}: \${e.message}\`);
                    }
                    return module.exports;
                };

                self.console = {
                    log: (...args) => self.postMessage({ t: 'log', m: args.join(' ') }),
                    error: (...args) => self.postMessage({ t: 'error', m: args.join(' ') }),
                    warn: (...args) => self.postMessage({ t: 'warn', m: args.join(' ') })
                };
                
                self.onmessage = (e) => {
                    const { type, id, request } = e.data;
                    if (type === 'init') {
                        Object.assign(files, e.data.files);
                    } else if (type === 'run') {
                        try {
                            customRequire(e.data.entry, '/');
                        } catch (err) { self.console.error(err.stack || err.message); } 
                        finally { self.postMessage({ t: 'done' }); }
                    } else if (type === 'http-request') {
                         if (!serverRequestHandler) {
                            self.postMessage({ t: 'http-response', id, error: 'No HTTP server is running.' });
                            return;
                        }
                        const req = { url: request.url, method: request.method, headers: request.headers };
                        const res = {
                            _headers: {}, _statusCode: 200,
                            setHeader: (n, v) => { res._headers[n.toLowerCase()] = v; },
                            writeHead: (sc, h) => { res._statusCode = sc; Object.assign(res._headers, h || {}); return res; },
                            end: (b) => self.postMessage({ t: 'http-response', id, response: { status: res._statusCode, headers: res._headers, body: b || '' }})
                        };
                        serverRequestHandler(req, res);
                    }
                };
            `;

            workerRef.current = new Worker(URL.createObjectURL(new Blob([workerCode])));
            workerRef.current.onmessage = (e) => {
                if (e.data.t === 'done') setState(s => ({ ...s, isRunning: false }));
                else if (e.data.t === 'server-ready') onBackendReady(true);
                else if (e.data.t === 'http-response') { /* Handled by Sandbox */ }
                else onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: e.data.t, message: e.data.m }] }));
            };
            workerRef.current.onerror = (e) => { onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'error', message: e.message }] })); setState(s => ({ ...s, isRunning: false })); };
            
            const resolvedEntryPoint = entryPoint || ['index.js', 'main.js', 'app.js', 'server.js'].find(f => f in files) || Object.keys(files).find(f => f.endsWith('.js'));
            if (resolvedEntryPoint) {
                onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'info', message: `Running ${resolvedEntryPoint}...` }] }));
                const filesToSend: { [key: string]: string } = {};
                for (const path in files) {
                    if (Object.prototype.hasOwnProperty.call(files, path)) {
                        filesToSend[path] = files[path].code;
                    }
                }
                workerRef.current.postMessage({ type: 'init', files: filesToSend });
                workerRef.current.postMessage({ type: 'run', entry: resolvedEntryPoint });
            } else {
                onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'error', message: 'No JS entry point found (e.g., index.js).' }] }));
                setState(s => ({...s, isRunning: false }));
            }
        } else {
             setState(s => ({...s, isRunning: false }));
        }
    }, [files, onBackendReady, onUpdate, projectType, entryPoint]);

    const handleStop = useCallback(() => {
        if (projectType === 'node' && workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
            onBackendReady(false);
            setState(s => ({ ...s, isRunning: false }));
            onUpdate(prev => ({ ...prev!, consoleOutput: [...(prev!.consoleOutput || []), { type: 'info', message: 'Execution stopped.' }] }));
        }
    }, [projectType, onBackendReady, onUpdate]);

    useImperativeHandle(ref, () => ({
        run: handleRun,
        stop: handleStop
    }));
    
    return (
        <div data-context-menu-id="preview-console" className="w-full h-full flex flex-col bg-background">
            <div className="flex-1 bg-black/50 p-4 font-mono text-sm text-text-secondary overflow-y-auto">
                {consoleOutput && consoleOutput.length > 0 ? (
                    consoleOutput.map((line, index) => (
                        <div key={index} className="group flex items-start gap-2 justify-between hover:bg-surface/50 -mx-4 px-4 py-0.5 rounded-md">
                            <pre className={`whitespace-pre-wrap flex-1 ${line.type === 'error' ? 'text-red-400' : line.type === 'info' ? 'text-blue-300' : ''}`}>
                                <span className="select-none text-text-tertiary mr-3">{'>'}</span>{line.message}
                            </pre>
                            {line.type === 'error' && Object.keys(files).length > 0 && (
                                <button onClick={() => onAutoFixRequest(line.message)} className="flex items-center gap-1.5 text-xs text-yellow-400/70 border border-yellow-400/20 bg-yellow-400/10 rounded-md px-2 py-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-yellow-400/20 hover:text-yellow-300" title="Ask AI to fix this error">
                                    <BoltIcon className="w-3 h-3" /> Auto-Fix
                                </button>
                            )}
                        </div>
                    ))
                ) : (
                    <div className="text-center text-text-tertiary pt-8 h-full flex flex-col items-center justify-center">
                        <TerminalIcon className="w-12 h-12 text-text-tertiary/50 mb-4" />
                        {projectType === 'python' || projectType === 'node' ? <p>Click "Run" in the header to execute the project.</p> : <p>Console output from the web preview will appear here.</p>}
                    </div>
                )}
            </div>
        </div>
    );
});


// --- Main Sandbox ---
export const Sandbox: React.FC<SandboxProps> = ({ sandboxState, onClose, onUpdate, onAutoFixRequest }) => {
    const { files, openFiles, activeFile, consoleOutput } = sandboxState;
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const terminalActionsRef = useRef<TerminalActions>(null);
    const runConfigRef = useRef<HTMLDivElement>(null);
    
    const [isBackendReady, setIsBackendReady] = useState(false);
    const [activeBottomTab, setActiveBottomTab] = useState<'preview' | 'terminal'>('preview');
    const [executionState, setExecutionState] = useState<ExecutionState>({ isRunning: false, isLoading: false, isPyodideReady: false });
    const [runConfigEntryPoint, setRunConfigEntryPoint] = useState<string | null>(null);
    const [isRunConfigOpen, setIsRunConfigOpen] = useState(false);

    const projectType: ProjectType = useMemo(() => {
        const fileNames = Object.keys(files || {});
        if (fileNames.length === 0) return 'unknown';
        if (fileNames.some(name => name.endsWith('.html') || name.endsWith('.jsx') || name.endsWith('.tsx'))) return 'web';
        if (fileNames.some(name => name.endsWith('.py'))) return 'python';
        if (fileNames.some(name => ['server.js', 'index.js', 'main.js', 'app.js'].includes(name) || name === 'package.json')) return 'node';
        if (fileNames.some(name => name.endsWith('.js'))) return 'web'; // Treat standalone JS as web
        return 'unknown';
    }, [files]);
    
    useEffect(() => {
      setIsBackendReady(false);
      setRunConfigEntryPoint(null); // Reset on file changes
    }, [sandboxState.files]);

    useEffect(() => {
        if (projectType === 'web') {
            setActiveBottomTab('preview');
        } else {
            setActiveBottomTab('terminal');
        }
    }, [projectType]);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
          if (runConfigRef.current && !runConfigRef.current.contains(event.target as Node)) {
            setIsRunConfigOpen(false);
          }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }, []);

    useEffect(() => {
      const handleMessages = async (event: MessageEvent) => {
        if (event.data?.source === 'preview-request') {
          // This functionality needs the pyodide instance and worker instance,
          // which are currently encapsulated in TerminalView.
          // For now, this feature is disabled as it requires a larger refactor.
          // In a future version, the worker/pyodide logic would be lifted to this component.
           const { id } = event.data;
           const errorData = 'Backend communication is currently being refactored.';
           iframeRef.current?.contentWindow?.postMessage({ source: 'sandbox-response', id, response: null, error: errorData }, '*');
        }
      };

      window.addEventListener('message', handleMessages);
      return () => window.removeEventListener('message', handleMessages);
    }, [projectType]);
    
    const handleSelectFile = (path: string) => {
        onUpdate(prev => ({ ...prev!, activeFile: path, openFiles: prev!.openFiles.includes(path) ? prev!.openFiles : [...prev!.openFiles, path] }));
    };

    const handleCloseTab = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onUpdate(prev => {
            const newOpenFiles = prev!.openFiles.filter(p => p !== path);
            let newActiveFile = prev!.activeFile;
            if (prev!.activeFile === path) {
                const closingIdx = prev!.openFiles.indexOf(path);
                newActiveFile = newOpenFiles[closingIdx] || newOpenFiles[closingIdx - 1] || newOpenFiles[0] || null;
            }
            return { ...prev!, openFiles: newOpenFiles, activeFile: newActiveFile };
        });
    };

    const handleCodeChange = (newCode: string) => {
        if (activeFile) {
            onUpdate(prev => ({ ...prev!, files: { ...prev!.files, [activeFile]: { ...prev!.files[activeFile], code: newCode } } }));
        }
    };
    
    const mapLanguageToMonaco = (lang: string) => {
        const l = lang?.toLowerCase() || 'plaintext';
        switch(l) {
            case 'jsx': return 'javascript';
            case 'js': return 'javascript';
            case 'ts': return 'typescript';
            case 'tsx': return 'typescript';
            case 'python': return 'python';
            case 'py': return 'python';
            case 'python-api': return 'python';
            default: return l;
        }
    }

    const editorLanguage = activeFile ? mapLanguageToMonaco(files[activeFile]?.language) : 'plaintext';
    
    const isRunnable = projectType === 'python' || projectType === 'node';
    const buttonDisabled = (projectType === 'python' && !executionState.isPyodideReady) || executionState.isLoading;
    const { isRunning, isLoading } = executionState;
    const runnableFiles = useMemo(() => Object.keys(files).filter(f => f.endsWith('.py') || f.endsWith('.js')), [files]);

    return (
        <div className="flex w-full h-full bg-background border-l border-border">
            <PanelGroup direction="horizontal">
                <Panel defaultSize={20} minSize={15} maxSize={40} className="flex flex-col min-w-0">
                    <FileExplorer files={files} activeFile={activeFile} onSelectFile={handleSelectFile} onUpdate={onUpdate} />
                </Panel>
                <PanelResizeHandle className="w-1 bg-border hover:bg-accent-hover transition-colors data-[resize-handle-state=drag]:bg-accent" />
                <Panel defaultSize={80} minSize={30} className="flex flex-col min-w-0">
                    <header className="flex items-center justify-between pl-4 pr-2 h-12 border-b border-border flex-shrink-0">
                        <h2 className="text-sm font-semibold truncate" title={activeFile || 'Sandbox'}>{activeFile?.split('/').pop() || 'Sandbox'}</h2>
                         <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
                           {isRunnable && (
                                <div className={`flex items-center rounded-md ${isRunning ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                                    <button
                                        onClick={() => isRunning ? terminalActionsRef.current?.stop() : terminalActionsRef.current?.run()}
                                        disabled={buttonDisabled}
                                        className={`flex items-center gap-2 pl-3 pr-3 py-1.5 rounded-l-md font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                            ${isRunning ? 'text-red-400 hover:bg-red-500/20' : 'text-green-400 hover:bg-green-500/20'}
                                        `}
                                    >
                                        {isRunning ? <StopIcon className="w-4 h-4" /> : (isLoading ? <RefreshIcon className="w-4 h-4 animate-spin" /> : <PlayIcon className="w-4 h-4" />)}
                                        {isRunning ? 'Stop' : (isLoading ? 'Loading...' : 'Run')}
                                    </button>
                                    <div ref={runConfigRef} className="relative h-full border-l border-white/10">
                                        <button 
                                          onClick={() => setIsRunConfigOpen(p => !p)} 
                                          disabled={isRunning || isLoading}
                                          className="p-1.5 h-full text-green-400 hover:bg-green-500/20 disabled:opacity-50 rounded-r-md" title="Run Configuration">
                                            <EllipsisVerticalIcon className="w-5 h-5"/>
                                        </button>
                                        {isRunConfigOpen && (
                                            <div className="absolute top-full right-0 mt-2 w-64 bg-surface border border-border rounded-lg shadow-2xl p-2 z-20 animate-slide-down-and-fade origin-top-right">
                                                <h3 className="text-xs font-semibold text-text-secondary px-2 pb-2">Select Entry Point</h3>
                                                <div className="max-h-60 overflow-y-auto">
                                                    <button onClick={() => { setRunConfigEntryPoint(null); setIsRunConfigOpen(false); }} className="w-full text-left text-sm flex items-center justify-between p-2 rounded-md hover:bg-accent-hover text-text-primary">
                                                        <span>Auto-detect</span>
                                                        {runConfigEntryPoint === null && <CheckIcon className="w-4 h-4 text-accent" />}
                                                    </button>
                                                    {runnableFiles.map(file => (
                                                        <button key={file} onClick={() => { setRunConfigEntryPoint(file); setIsRunConfigOpen(false); }} className="w-full text-left text-sm flex items-center justify-between p-2 rounded-md hover:bg-accent-hover text-text-primary">
                                                            <span className="truncate">{file}</span>
                                                            {runConfigEntryPoint === file && <CheckIcon className="w-4 h-4 text-accent" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                             {isBackendReady && (
                                <div className="flex items-center gap-2 text-xs text-green-400 animate-fade-in">
                                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-fast"></span>
                                    Backend Live
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                          {consoleOutput && consoleOutput.length > 0 && (
                            <button onClick={() => onUpdate(p => ({ ...p!, consoleOutput: [] }))} title="Clear Console" className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary">
                                <TrashIcon className="w-4 h-4" />
                            </button>
                           )}
                          <button onClick={onClose} className="p-2 rounded-md text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors">
                              <XMarkIcon className="w-5 h-5" />
                          </button>
                        </div>
                    </header>
                    
                    <PanelGroup direction="vertical">
                        <Panel defaultSize={60} minSize={10} className="flex flex-col min-w-0">
                            <div className="flex items-end border-b border-border bg-surface/30 h-10 overflow-x-auto flex-shrink-0">
                                {openFiles.map(path => (
                                    <button key={path} onClick={() => handleSelectFile(path)} className={`flex items-center gap-2 pl-4 pr-2 h-full text-sm border-r border-border transition-colors ${activeFile === path ? 'bg-background text-text-primary' : 'text-text-secondary hover:bg-surface'}`}>
                                        <span className="truncate max-w-xs">{path.split('/').pop()}</span>
                                        <span onClick={(e) => handleCloseTab(path, e)} className="p-1 rounded-full hover:bg-accent-hover"><XMarkIcon className="w-3.5 h-3.5"/></span>
                                    </button>
                                ))}
                            </div>
                             <main className="flex-1 bg-background overflow-auto relative">
                                {activeFile ? (
                                    <Editor
                                        key={activeFile}
                                        path={activeFile}
                                        value={files[activeFile]?.code || ''}
                                        language={editorLanguage}
                                        onChange={(value) => handleCodeChange(value || '')}
                                        theme="vs-dark"
                                        options={{ 
                                            minimap: { enabled: false }, 
                                            scrollBeyondLastLine: false, 
                                            wordWrap: 'on',
                                            fontSize: 14,
                                            tabSize: 2,
                                        }}
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-center text-text-secondary">
                                       <CodeBracketIcon className="w-16 h-16 mb-4 opacity-20"/>
                                       <p>No file selected</p>
                                       <p className="text-sm text-text-tertiary">Select a file from the explorer to begin editing.</p>
                                    </div>
                                )}
                            </main>
                        </Panel>
                        <PanelResizeHandle className="h-1 bg-border hover:bg-accent-hover transition-colors data-[resize-handle-state=drag]:bg-accent" />
                        <Panel defaultSize={40} minSize={10} className="flex flex-col min-w-0">
                            <div className="flex flex-col min-w-0 h-full">
                                {/* Tab Headers */}
                                <div className="flex items-center border-b border-border flex-shrink-0 h-10 bg-surface/30">
                                    {projectType === 'web' && (
                                        <button
                                            onClick={() => setActiveBottomTab('preview')}
                                            className={`flex items-center gap-2 px-4 h-full text-sm border-r border-border transition-colors ${activeBottomTab === 'preview' ? 'bg-background text-text-primary' : 'text-text-secondary hover:bg-surface'}`}
                                        >
                                            <EyeIcon className="w-4 h-4" />
                                            Preview
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setActiveBottomTab('terminal')}
                                        className={`flex items-center gap-2 px-4 h-full text-sm border-r border-border transition-colors ${activeBottomTab === 'terminal' ? 'bg-background text-text-primary' : 'text-text-secondary hover:bg-surface'}`}
                                    >
                                        <TerminalIcon className="w-4 h-4" />
                                        Console
                                    </button>
                                </div>

                                {/* Tab Content */}
                                <div className="flex-1 overflow-hidden relative">
                                    <div className={`w-full h-full ${activeBottomTab === 'preview' && projectType === 'web' ? 'block' : 'hidden'}`}>
                                        <PreviewView files={files} onUpdate={onUpdate} iframeRef={iframeRef} />
                                    </div>
                                    <div className={`w-full h-full ${activeBottomTab === 'terminal' ? 'block' : 'hidden'}`}>
                                        <TerminalView
                                            ref={terminalActionsRef}
                                            files={files}
                                            projectType={projectType}
                                            consoleOutput={consoleOutput}
                                            onUpdate={onUpdate}
                                            onAutoFixRequest={onAutoFixRequest}
                                            onBackendReady={setIsBackendReady}
                                            onStateChange={setExecutionState}
                                            entryPoint={runConfigEntryPoint}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Panel>
                    </PanelGroup>
                </Panel>
            </PanelGroup>
        </div>
    );
};