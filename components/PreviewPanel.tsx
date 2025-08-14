import React, { useState, useEffect, useCallback, useRef } from 'react';
import { XMarkIcon, CodeBracketIcon, EyeIcon, TerminalIcon, PlayIcon, BoltIcon, Html5Icon, ReactIcon, PythonIcon, ComputerDesktopIcon, DevicePhoneMobileIcon, DeviceTabletIcon, ArrowPathIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from './icons';

interface PreviewPanelProps {
  code: string;
  language: string;
  onClose: () => void;
}

declare global {
  interface Window {
    loadPyodide: (config: { indexURL: string }) => Promise<any>;
  }
}

// --- Helper Functions and Types ---

const buildSrcDoc = (code: string, language: string) => {
  if (language === 'html') return code;
  if (language === 'jsx') {
    const codeBody = code.replace(/import\s+.*\s+from\s+['"].*['"];?/g, '').replace(/export\s+default\s+\w+;?/g, '');
    const componentNameMatch = [...codeBody.matchAll(/(?:const|function)\s+([A-Z]\w*)\s*=/g)];
    const lastComponent = componentNameMatch.pop();
    const componentNameToRender = lastComponent ? lastComponent[1] : null;
    const renderLogic = componentNameToRender ? `
        try {
          const container = document.getElementById('root');
          const root = ReactDOM.createRoot(container);
          root.render(React.createElement(${componentNameToRender}));
        } catch(e) { console.error(e); }
      ` : `document.getElementById('root').innerText = 'Could not find a React component to render.'`;
    const consoleInterceptor = `
      const postMsg = (type, args) => window.parent.postMessage({ source: 'preview-iframe', type, payload: args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' ') }, '*');
      ['log', 'warn', 'error'].forEach(type => {
        const original = console[type];
        console[type] = (...args) => { postMsg(type, args); original.apply(console, args); };
      });
      window.addEventListener('error', e => postMsg('error', [e.message]));
    `;
    return `<!DOCTYPE html><html><head>
        <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
        <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
        <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
        <style>body { font-family: sans-serif; margin: 0; padding: 1rem; background-color: #111213; color: #f1f5f9; }</style>
    </head><body><div id="root"></div><script type="text/babel">
        var process = { env: { NODE_ENV: 'development' } };
        (function() { ${consoleInterceptor}; ${codeBody}; ${renderLogic}; })();
    </script></body></html>`;
  }
  return 'Unsupported language for preview.';
};

type TerminalTab = 'preview' | 'console' | 'api';
interface ApiEndpoint { name: string; args: { name: string; type: string }[]; }
interface FormValues { [key: string]: string | number; }
interface ApiResponses { [key: string]: any; }

const parsePythonFunctions = (code: string): ApiEndpoint[] => {
  const endpoints: ApiEndpoint[] = [];
  const funcRegex = /def\s+(\w+)\s*\(([^)]*)\):/g;
  let match;
  while ((match = funcRegex.exec(code)) !== null) {
    const name = match[1];
    if (name.startsWith('_')) continue;
    const argsStr = match[2];
    const args = argsStr.split(',').map(arg => {
      const parts = arg.trim().split(':');
      const argName = parts[0].trim();
      const argType = parts.length > 1 ? parts[1].trim() : 'any';
      return { name: argName, type: argType };
    }).filter(arg => arg.name);
    endpoints.push({ name, args });
  }
  return endpoints;
};

// --- Sub-components ---

const ApiRunner: React.FC<{
    endpoints: ApiEndpoint[],
    onRun: (endpointName: string, args: FormValues) => void,
    responses: ApiResponses,
    isRunning: boolean
}> = ({ endpoints, onRun, responses, isRunning }) => {
    const [formValues, setFormValues] = useState<{[key: string]: FormValues}>({});

    const handleInputChange = (endpointName: string, argName: string, value: string) => {
        setFormValues(prev => ({
            ...prev,
            [endpointName]: { ...prev[endpointName], [argName]: value }
        }));
    };

    const handleSubmit = (e: React.FormEvent, endpointName: string) => {
        e.preventDefault();
        onRun(endpointName, formValues[endpointName] || {});
    };

    if (endpoints.length === 0) {
        return <div className="p-4 text-text-secondary text-center">No API functions found in the code.</div>
    }

    return (
        <div className="p-4 space-y-6 overflow-y-auto h-full">
            {endpoints.map(endpoint => (
                <div key={endpoint.name} className="bg-surface/50 rounded-lg border border-border">
                    <form onSubmit={(e) => handleSubmit(e, endpoint.name)}>
                        <div className="p-3 border-b border-border">
                            <h3 className="font-mono text-lg text-text-primary">{endpoint.name}</h3>
                        </div>
                        <div className="p-3 space-y-3">
                            {endpoint.args.map(arg => (
                                <div key={arg.name}>
                                    <label className="block text-sm font-medium text-text-secondary mb-1 font-mono">
                                        {arg.name}: <span className="text-text-tertiary">{arg.type}</span>
                                    </label>
                                    <input
                                        type={(arg.type.includes('int') || arg.type.includes('float')) ? 'number' : 'text'}
                                        onChange={e => handleInputChange(endpoint.name, arg.name, e.target.value)}
                                        value={formValues[endpoint.name]?.[arg.name] ?? ''}
                                        className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                                        aria-label={`${endpoint.name} argument ${arg.name}`}
                                    />
                                </div>
                            ))}
                            {endpoint.args.length === 0 && <p className="text-sm text-text-tertiary">This function takes no arguments.</p>}
                        </div>
                        <div className="p-3 border-t border-border flex justify-end">
                            <button type="submit" disabled={isRunning} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors bg-accent-hover text-text-primary hover:bg-border disabled:opacity-50 disabled:cursor-wait">
                                <BoltIcon className="w-4 h-4"/>
                                {isRunning ? 'Calling...' : 'Call API'}
                            </button>
                        </div>
                    </form>
                    {responses[endpoint.name] && (
                        <div className="border-t border-border p-3 bg-black/20">
                            <h4 className="text-sm text-text-secondary mb-2">Response:</h4>
                            <pre className="text-xs bg-background p-2 rounded-md overflow-x-auto">
                                <code>{JSON.stringify(responses[endpoint.name], null, 2)}</code>
                            </pre>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};


// --- Main Panel Component ---

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ code, language, onClose }) => {
  const isPython = language === 'python' || language === 'python-api';
  const initialTab: TerminalTab = isPython ? (language === 'python-api' ? 'api' : 'console') : 'preview';

  const [activeTerminalTab, setActiveTerminalTab] = useState<TerminalTab>(initialTab);
  const [editorCode, setEditorCode] = useState(code);
  const [srcDoc, setSrcDoc] = useState('');
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const pyodideRef = useRef<any>(null);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(250);
  const terminalRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const stopDragRef = useRef<(() => void) | null>(null);

  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiResponses, setApiResponses] = useState<ApiResponses>({});
  
  const [device, setDevice] = useState<'none' | 'phone' | 'tablet'>('none');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const toggleOrientation = () => setOrientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');

  const [isFullScreen, setIsFullScreen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleDrag = (e: MouseEvent) => {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 80 && newHeight < window.innerHeight - 200) {
            setTerminalHeight(newHeight);
        }
    };
    
    const stopDrag = () => {
        isDraggingRef.current = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', stopDrag);
        stopDragRef.current = null;
    };

    stopDragRef.current = stopDrag;

    window.addEventListener('mousemove', handleDrag);
    window.addEventListener('mouseup', stopDrag);
  }, []);

  useEffect(() => {
    return () => stopDragRef.current?.();
  }, []);

  useEffect(() => {
    const initPyodide = async () => {
      setConsoleOutput(['Initializing Python environment...']);
      if (activeTerminalTab !== 'console') setActiveTerminalTab('console');
      try {
        const pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });
        setConsoleOutput(prev => [...prev, 'Loading numpy and pandas...']);
        await pyodide.loadPackage(['numpy', 'pandas']);
        pyodideRef.current = pyodide;
        setIsPyodideReady(true);
        setConsoleOutput(prev => [...prev, 'Python environment ready.']);
      } catch (error) {
        console.error("Pyodide loading failed:", error);
        setConsoleOutput(prev => [...prev, `Error: Failed to initialize Python environment. ${(error as Error).message}`]);
      }
    };
    if (isPython && !pyodideRef.current) {
      initPyodide();
    }
  }, [isPython, activeTerminalTab]);

  useEffect(() => {
    setEditorCode(code);
    setConsoleOutput([]);
    setApiResponses({});
    setActiveTerminalTab(initialTab);
    setDevice('none');
    setOrientation('portrait');
  }, [code, language, initialTab]);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      if (language === 'jsx' || language === 'html') setSrcDoc(buildSrcDoc(editorCode, language));
      if (language === 'python-api') setApiEndpoints(parsePythonFunctions(editorCode));
    }, 250);
    return () => clearTimeout(handler);
  }, [editorCode, language]);

  useEffect(() => {
    const handleIframeMessages = (event: MessageEvent) => {
      if (event.data?.source === 'preview-iframe') {
        setConsoleOutput(prev => [...prev, `[PREVIEW:${event.data.type.toUpperCase()}] ${event.data.payload}`]);
      }
    };
    window.addEventListener('message', handleIframeMessages);
    return () => window.removeEventListener('message', handleIframeMessages);
  }, []);

  const runPython = useCallback(async (pyCode: string) => {
    if (!pyodideRef.current || !isPyodideReady) {
        setConsoleOutput(prev => [...prev, `[ERROR] Python environment not ready.`]);
        return null;
    }
    setIsRunning(true);
    let result = null;
    try {
      const pyodide = pyodideRef.current;
      pyodide.setStdout({ batched: (msg: string) => setConsoleOutput(prev => [...prev, msg]) });
      pyodide.setStderr({ batched: (msg: string) => setConsoleOutput(prev => [...prev, `[ERROR] ${msg}`]) });
      result = await pyodide.runPythonAsync(pyCode);
    } catch (err) {
      setConsoleOutput(prev => [...prev, `[CRITICAL ERROR] ${(err as Error).message}`]);
    } finally {
      setIsRunning(false);
    }
    return result;
  }, [isPyodideReady]);

  const handleRunPythonScript = () => {
    setConsoleOutput([`Running script...`]);
    if(activeTerminalTab !== 'console') setActiveTerminalTab('console');
    runPython(editorCode);
  };

  const handleRefresh = () => {
    if (language === 'python') {
      handleRunPythonScript();
    } else {
      setRefreshKey(prev => prev + 1);
    }
  };
  
  const handleApiCall = async (endpointName: string, args: FormValues) => {
    setApiResponses(prev => ({ ...prev, [endpointName]: 'Running...' }));
    if(activeTerminalTab !== 'console') setActiveTerminalTab('console');
    
    await runPython(editorCode);

    const argString = Object.entries(args).map(([key, value]) => {
      const endpoint = apiEndpoints.find(e => e.name === endpointName);
      const argType = endpoint?.args.find(a => a.name === key)?.type || 'any';
      if (typeof value === 'string' && !(argType.includes('int') || argType.includes('float'))) {
        return `${key}="${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    }).join(', ');
      
    const callCode = `import json\njson.dumps(${endpointName}(${argString}))`;
    const resultJson = await runPython(callCode);
    
    try {
        const responseData = resultJson ? JSON.parse(resultJson) : { error: 'No return value from function.' };
        setApiResponses(prev => ({ ...prev, [endpointName]: responseData }));
    } catch (e) {
        setApiResponses(prev => ({ ...prev, [endpointName]: { error: 'Failed to parse response.', details: (e as Error).message, raw: resultJson } }));
    }
  };

  const TabButton: React.FC<{ tab: TerminalTab, children: React.ReactNode, disabled?: boolean }> = ({ tab, children, disabled }) => (
    <button onClick={() => setActiveTerminalTab(tab)} disabled={disabled} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-b-2 ${ activeTerminalTab === tab ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border' }`} aria-pressed={activeTerminalTab === tab}>
      {children}
    </button>
  );

  const getFileInfo = useCallback(() => {
    switch (language) {
        case 'jsx': return { icon: <ReactIcon className="w-5 h-5 text-[#61DAFB]" />, name: 'component.jsx' };
        case 'html': return { icon: <Html5Icon className="w-5 h-5 text-[#E34F26]" />, name: 'index.html' };
        case 'python': return { icon: <PythonIcon className="w-5 h-5 text-[#3776AB]" />, name: 'script.py' };
        case 'python-api': return { icon: <PythonIcon className="w-5 h-5 text-[#3776AB]" />, name: 'api.py' };
        default: return { icon: <CodeBracketIcon className="w-5 h-5" />, name: 'code' };
    }
  }, [language]);

  const { icon: langIcon, name: langName } = getFileInfo();

  return (
    <div className={isFullScreen
        ? "fixed inset-0 z-50 bg-background flex"
        : "flex w-full md:w-1/2 md:max-w-[50%] bg-background border-l border-border animate-fade-in absolute inset-0 z-20 md:relative md:inset-auto md:z-auto"
    }>
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between p-2 pl-4 border-b border-border flex-shrink-0 bg-surface">
            <div className="flex items-center gap-2" title={langName}>
                {langIcon}
                <span className="text-sm text-text-primary font-medium truncate">{langName}</span>
            </div>
            <div className="flex items-center gap-1">
                {language === 'python' && (
                    <button onClick={handleRunPythonScript} disabled={!isPyodideReady || isRunning} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors bg-green-600/20 text-green-400 hover:bg-green-600/40 disabled:opacity-50 disabled:cursor-wait">
                        <PlayIcon className="w-4 h-4"/>
                        {isRunning ? 'Running...' : 'Run'}
                    </button>
                )}
                <button onClick={onClose} className="p-1.5 rounded-md text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors" aria-label="Close Sandbox">
                    <XMarkIcon className="w-5 h-5" />
                </button>
            </div>
        </header>
        <main className="flex-1 flex flex-col overflow-hidden bg-background">
            <div className="flex-1 overflow-auto">
                <textarea value={editorCode} onChange={(e) => setEditorCode(e.target.value)} className="w-full h-full bg-transparent text-text-primary p-4 resize-none font-mono text-sm leading-6 focus:outline-none" spellCheck="false" aria-label="Code Editor"/>
            </div>
            
            <div onMouseDown={startDrag} className="w-full h-1.5 bg-border hover:bg-accent/50 transition-colors cursor-row-resize flex-shrink-0" />
            
            <div ref={terminalRef} style={{ height: `${terminalHeight}px`}} className="w-full flex flex-col overflow-hidden flex-shrink-0 bg-surface">
                <div className="flex items-center gap-1 px-2 border-b border-border">
                    <TabButton tab="preview" disabled={isPython}><EyeIcon className="w-4 h-4" /> Preview</TabButton>
                    {language === 'python-api' && <TabButton tab="api"><BoltIcon className="w-4 h-4" /> API Runner</TabButton>}
                    <TabButton tab="console"><TerminalIcon className="w-4 h-4" /> Console</TabButton>
                </div>
                <div className="flex-1 overflow-auto">
                    {activeTerminalTab === 'api' && language === 'python-api' && (
                        <ApiRunner endpoints={apiEndpoints} onRun={handleApiCall} responses={apiResponses} isRunning={isRunning} />
                    )}
                    {activeTerminalTab === 'preview' && !isPython && (
                        <div className="flex flex-col h-full bg-black/20">
                            <div className="flex items-center gap-1 p-1.5 border-b border-border bg-surface/80 flex-shrink-0">
                                <button onClick={() => setDevice('none')} title="Desktop" className={`p-1.5 rounded-md transition-colors ${device === 'none' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`} aria-pressed={device === 'none'}>
                                    <ComputerDesktopIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => setDevice('phone')} title="Phone" className={`p-1.5 rounded-md transition-colors ${device === 'phone' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`} aria-pressed={device === 'phone'}>
                                    <DevicePhoneMobileIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => setDevice('tablet')} title="Tablet" className={`p-1.5 rounded-md transition-colors ${device === 'tablet' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:bg-surface hover:text-text-primary'}`} aria-pressed={device === 'tablet'}>
                                    <DeviceTabletIcon className="w-5 h-5" />
                                </button>
                                {device !== 'none' && (
                                    <button onClick={toggleOrientation} title="Rotate" className="p-1.5 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors" aria-label="Toggle orientation">
                                        <ArrowPathIcon className="w-5 h-5 -rotate-90" />
                                    </button>
                                )}
                                <div className="flex-grow" />
                                <button onClick={handleRefresh} title="Refresh Preview" className="p-1.5 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors" aria-label="Refresh Preview">
                                    <ArrowPathIcon className="w-5 h-5" />
                                </button>
                                <button onClick={() => setIsFullScreen(fs => !fs)} title={isFullScreen ? 'Exit Fullscreen' : 'Enter Fullscreen'} className="p-1.5 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors" aria-label={isFullScreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}>
                                    {isFullScreen ? <ArrowsPointingInIcon className="w-5 h-5" /> : <ArrowsPointingOutIcon className="w-5 h-5" />}
                                </button>
                            </div>
                            <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-auto">
                                <div className={`
                                    relative bg-black shadow-2xl shadow-black/50 transition-all duration-300 ease-in-out flex-shrink-0
                                    ${device === 'none' ? 'w-full h-full' : 'border-black rounded-[2.5rem]'}
                                    ${device === 'phone' ? `border-[14px] ${orientation === 'portrait' ? 'w-[375px] h-[667px]' : 'w-[667px] h-[375px]'}` : ''}
                                    ${device === 'tablet' ? `border-[16px] ${orientation === 'portrait' ? 'w-[768px] h-[1024px]' : 'w-[1024px] h-[768px]'}` : ''}
                                `}>
                                    <iframe
                                        key={refreshKey}
                                        srcDoc={srcDoc}
                                        title="Preview"
                                        sandbox="allow-scripts allow-modals"
                                        className="w-full h-full border-0 bg-background"
                                        style={device !== 'none' ? { borderRadius: '1.5rem' } : {}}
                                        aria-label="Code Preview"
                                    />
                                    {device !== 'none' && (
                                        <div className={`
                                            absolute bg-black z-10
                                            ${orientation === 'portrait' ? 'left-1/2 -translate-x-1/2 -top-[1px] h-7 w-1/3 rounded-b-xl' : 'top-1/2 -translate-y-1/2 -left-[1px] w-7 h-1/4 rounded-r-xl'}
                                        `}></div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTerminalTab === 'console' && (
                        <div className="w-full h-full p-4 font-mono text-xs text-text-secondary overflow-y-auto">
                            {consoleOutput.map((line, index) => (
                                <pre key={index} className={`whitespace-pre-wrap ${line.startsWith('[ERROR]') || line.startsWith('[CRITICAL') ? 'text-red-400' : ''}`}>
                                    <span className="select-none text-text-tertiary mr-2">{'>'}</span>{line}
                                </pre>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </main>
      </div>
    </div>
  );
};