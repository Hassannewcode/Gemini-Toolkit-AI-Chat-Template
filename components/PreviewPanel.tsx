import React, { useState, useEffect, useCallback, useRef } from 'react';
import { XMarkIcon, CodeBracketIcon, EyeIcon, TerminalIcon, PlayIcon, BoltIcon, Html5Icon, ReactIcon, PythonIcon, ComputerDesktopIcon, DevicePhoneMobileIcon, DeviceTabletIcon, RefreshIcon, RotateCwIcon, ExpandIcon, CollapseIcon, JavaScriptIcon } from './icons';

interface PreviewPanelProps {
  code: string;
  language: string;
  consoleOutput: { type: string; message: string }[];
  onClose: () => void;
  onCodeUpdate: (newCode: string) => void;
  onAutoFixRequest: (error: string, code: string, language: string) => void;
  onConsoleUpdate: (line: { type: string; message: string }) => void;
  onClearConsole: () => void;
}

declare global {
  interface Window {
    loadPyodide: (config: { indexURL: string }) => Promise<any>;
    hljs: any;
  }
}

// --- Helper Functions and Types ---

let pyodideLoaderPromise: Promise<void> | null = null;
const loadPyodideScript = (): Promise<void> => {
    if (!pyodideLoaderPromise) {
        pyodideLoaderPromise = new Promise((resolve, reject) => {
            if (window.loadPyodide) {
                return resolve();
            }
            const script = document.createElement('script');
            script.src = "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js";
            script.id = "pyodide-script";
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => {
                pyodideLoaderPromise = null; 
                document.head.removeChild(script);
                reject(new Error('Failed to load Pyodide script.'));
            };
            document.head.appendChild(script);
        });
    }
    return pyodideLoaderPromise;
};

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
    
const buildSrcDoc = (code: string, language: string) => {
  if (language === 'html') return code;
  if (language === 'javascript') {
    return `<!DOCTYPE html><html><head>
        <style>body { font-family: sans-serif; margin: 0; background-color: white; color: black; }</style>
    </head><body><div id="root"></div><script>
        (function() { ${consoleInterceptor}; ${code}; })();
    </script></body></html>`;
  }
  if (language === 'jsx') {
    const codeBody = code.replace(/import\s+.*from\s+['"].*['"];?/g, '').replace(/export\s+default\s+\w+;?/g, '');
    const componentMatches = [...codeBody.matchAll(/(?:function|class)\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=\s*(?:function|\()/g)];
    const componentNameToRender = componentMatches.length > 0 ? componentMatches[componentMatches.length - 1][1] || componentMatches[componentMatches.length - 1][2] : null;

    return `<!DOCTYPE html><html><head>
        <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
        <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
        <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
        <style>body { font-family: sans-serif; margin: 0; background-color: white; color: black; }</style>
    </head><body><div id="root"></div><script type="text/babel">
        var process = { env: { NODE_ENV: 'development' } };
        (function() { 
          ${consoleInterceptor}; 
          ${codeBody}; 
          const container = document.getElementById('root');
          if (container && ${componentNameToRender}) {
            const root = ReactDOM.createRoot(container);
            root.render(React.createElement(${componentNameToRender}));
          }
        })();
    </script></body></html>`;
  }
  return 'Unsupported language for preview.';
};

type ActiveTab = 'editor' | 'preview' | 'console' | 'api';
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
        return <div className="p-6 text-text-secondary text-center">No API functions found in the code. Run the code to load them.</div>
    }

    return (
        <div className="p-4 space-y-6">
            {endpoints.map(endpoint => (
                <div key={endpoint.name} className="bg-surface/50 rounded-lg border border-border animate-fade-in">
                    <form onSubmit={(e) => handleSubmit(e, endpoint.name)}>
                        <div className="p-4 border-b border-border">
                            <h3 className="font-mono text-lg text-text-primary">{endpoint.name}</h3>
                        </div>
                        <div className="p-4 space-y-4">
                            {endpoint.args.map(arg => (
                                <div key={arg.name}>
                                    <label className="block text-sm font-medium text-text-secondary mb-1.5 font-mono">
                                        {arg.name}: <span className="text-text-tertiary">{arg.type}</span>
                                    </label>
                                    <input
                                        type={(arg.type.includes('int') || arg.type.includes('float')) ? 'number' : 'text'}
                                        onChange={e => handleInputChange(endpoint.name, arg.name, e.target.value)}
                                        value={formValues[endpoint.name]?.[arg.name] ?? ''}
                                        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                                        aria-label={`${endpoint.name} argument ${arg.name}`}
                                    />
                                </div>
                            ))}
                            {endpoint.args.length === 0 && <p className="text-sm text-text-tertiary">This function takes no arguments.</p>}
                        </div>
                        <div className="p-3 border-t border-border flex justify-end">
                            <button type="submit" disabled={isRunning} className="flex items-center gap-2 px-4 py-2 text-sm rounded-md transition-colors bg-accent-hover text-text-primary hover:bg-border disabled:opacity-50 disabled:cursor-wait">
                                <BoltIcon className="w-4 h-4"/>
                                {isRunning ? 'Calling...' : 'Call API'}
                            </button>
                        </div>
                    </form>
                    {responses[endpoint.name] && (
                        <div className="border-t border-border p-4 bg-black/20 animate-fade-in">
                            <h4 className="text-sm text-text-secondary mb-2">Response:</h4>
                            <pre className="text-xs bg-background p-3 rounded-md overflow-x-auto">
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

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ code, language, consoleOutput, onClose, onCodeUpdate, onAutoFixRequest, onConsoleUpdate, onClearConsole }) => {
  const isPython = language === 'python' || language === 'python-api';
  const isWebPreview = ['html', 'jsx', 'javascript'].includes(language);
  const initialTab: ActiveTab = isWebPreview ? 'preview' : isPython ? 'console' : 'editor';

  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [srcDoc, setSrcDoc] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const pyodideRef = useRef<any>(null);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiResponses, setApiResponses] = useState<ApiResponses>({});
  
  const [device, setDevice] = useState<'none' | 'phone' | 'tablet'>('none');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPanelFullscreen, setIsPanelFullscreen] = useState(false);
  
  const hasAutoRun = useRef(false);

  useEffect(() => {
    const initPyodide = async () => {
      onConsoleUpdate({ type: 'info', message: 'Initializing Python environment...' });
      try {
        await loadPyodideScript();
        onConsoleUpdate({ type: 'info', message: 'Python environment loaded. Setting up runtime...' });
        
        if (!pyodideRef.current) {
          const pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });
          await pyodide.loadPackage(['numpy', 'pandas']);
          pyodideRef.current = pyodide;
          setIsPyodideReady(true);
          onConsoleUpdate({ type: 'info', message: 'Python environment ready.' });
        }
      } catch (error) {
        onConsoleUpdate({ type: 'error', message: `Failed to initialize Python environment. ${(error as Error).message}` });
      }
    };
    if (isPython && !pyodideRef.current) {
      initPyodide();
    }
  }, [isPython, onConsoleUpdate]);

  useEffect(() => {
    hasAutoRun.current = false;
    // Do not clear console here, parent manages it
    setApiResponses({});
    setActiveTab(initialTab);
    setDevice('none');
    setOrientation('portrait');
    setApiEndpoints(language === 'python-api' ? parsePythonFunctions(code) : []);
  }, [code, language, initialTab]);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      if (isWebPreview) setSrcDoc(buildSrcDoc(code, language));
    }, 250);
    return () => clearTimeout(handler);
  }, [code, language, isWebPreview]);

  useEffect(() => {
    const handleIframeMessages = (event: MessageEvent) => {
      if (event.data?.source === 'preview-iframe') {
        setActiveTab('console');
        onConsoleUpdate({ type: event.data.type, message: `[PREVIEW] ${event.data.payload}` });
      }
    };
    window.addEventListener('message', handleIframeMessages);
    return () => window.removeEventListener('message', handleIframeMessages);
  }, [onConsoleUpdate]);

  const runPython = useCallback(async (pyCode: string) => {
    if (!pyodideRef.current || !isPyodideReady) return null;
    setIsRunning(true);
    let result = null;
    try {
      const pyodide = pyodideRef.current;
      pyodide.setStdout({ batched: (msg: string) => onConsoleUpdate({ type: 'log', message: msg }) });
      pyodide.setStderr({ batched: (msg: string) => onConsoleUpdate({ type: 'error', message: msg }) });
      result = await pyodide.runPythonAsync(pyCode);
    } catch (err) {
      onConsoleUpdate({ type: 'error', message: (err as Error).message });
    } finally {
      setIsRunning(false);
    }
    return result;
  }, [isPyodideReady, onConsoleUpdate]);

  const handleRunCode = useCallback((codeToRun: string) => {
    if (!isPython || !isPyodideReady) return;
    onClearConsole();
    onConsoleUpdate({ type: 'info', message: 'Running code...' });
    setActiveTab('console');
    runPython(codeToRun).then(() => {
      if (language === 'python-api') {
        const endpoints = parsePythonFunctions(codeToRun);
        setApiEndpoints(endpoints);
        if (endpoints.length > 0) setActiveTab('api');
      } else {
        onConsoleUpdate({ type: 'info', message: "Script finished." });
      }
    });
  }, [isPython, isPyodideReady, language, runPython, onConsoleUpdate, onClearConsole]);
  
  useEffect(() => {
    if (language === 'python-api' && isPyodideReady && !hasAutoRun.current) {
      hasAutoRun.current = true;
      handleRunCode(code);
    }
  }, [isPyodideReady, language, code, handleRunCode]);

  const handleApiCall = async (endpointName: string, args: FormValues) => {
    onClearConsole();
    setActiveTab('console');
    setApiResponses(prev => ({ ...prev, [endpointName]: 'Running...' }));
    
    await runPython(code); // ensure functions are defined

    const argString = Object.entries(args).map(([key, value]) => 
        typeof value === 'string' ? `${key}="${value.replace(/"/g, '\\"')}"` : `${key}=${value}`
    ).join(', ');
      
    const callCode = `import json\njson.dumps(${endpointName}(${argString}))`;
    const resultJson = await runPython(callCode);
    
    try {
        setApiResponses(prev => ({ ...prev, [endpointName]: resultJson ? JSON.parse(resultJson) : { error: 'No return value' } }));
    } catch (e) {
        setApiResponses(prev => ({ ...prev, [endpointName]: { error: 'Failed to parse response', raw: resultJson } }));
    }
  };
  
  const TabButton: React.FC<{ tab: ActiveTab, children: React.ReactNode, disabled?: boolean }> = ({ tab, children, disabled }) => (
    <button onClick={() => setActiveTab(tab)} disabled={disabled} data-active={activeTab === tab} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed border-b-2 data-[active=true]:border-accent data-[active=true]:text-text-primary border-transparent text-text-secondary hover:text-text-primary`}>
      {children}
    </button>
  );

  const getFileInfo = useCallback(() => {
    switch (language) {
        case 'jsx': return { icon: <ReactIcon className="w-5 h-5 text-[#61DAFB]" />, name: 'component.jsx' };
        case 'html': return { icon: <Html5Icon className="w-5 h-5 text-[#E34F26]" />, name: 'index.html' };
        case 'javascript': return { icon: <JavaScriptIcon className="w-5 h-5" />, name: 'script.js' };
        case 'python': return { icon: <PythonIcon className="w-5 h-5 text-[#3776AB]" />, name: 'script.py' };
        case 'python-api': return { icon: <PythonIcon className="w-5 h-5 text-[#3776AB]" />, name: 'api.py' };
        default: return { icon: <CodeBracketIcon className="w-5 h-5" />, name: `source.${language}` };
    }
  }, [language]);

  const { icon: langIcon, name: langName } = getFileInfo();

  const phoneFrameClass = `relative bg-stone-800 rounded-[2.5rem] p-4 shadow-2xl shadow-black/50 
    before:content-[''] before:absolute before:inset-0 before:border-[2px] before:border-stone-700 before:rounded-[2.5rem]
    after:content-[''] after:absolute after:z-10 after:bg-stone-900 
    ${orientation === 'portrait' ? 
        'w-[375px] h-[667px] after:top-0 after:left-1/2 after:-translate-x-1/2 after:h-7 after:w-1/3 after:rounded-b-xl' : 
        'w-[667px] h-[375px] after:left-0 after:top-1/2 after:-translate-y-1/2 after:w-7 after:h-1/4 after:rounded-r-xl'
    }`;

  return (
    <div className={`flex flex-col w-full h-full bg-surface border-l border-border ${isPanelFullscreen ? 'fixed inset-0 z-50' : 'relative'} overflow-hidden`}>
        <header className="flex items-center justify-between pl-4 pr-2 h-12 border-b border-border flex-shrink-0 bg-background">
            <div className="flex items-center gap-3">
                {langIcon}
                <span className="text-sm text-text-primary font-medium">{langName}</span>
            </div>
            <div className="flex items-center gap-1">
                 {isPython && (
                    <button onClick={() => handleRunCode(code)} disabled={!isPyodideReady || isRunning} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors bg-green-600/20 text-green-300 hover:bg-green-600/40 disabled:opacity-50 disabled:cursor-wait">
                        <PlayIcon className="w-4 h-4"/>
                        {isRunning ? 'Running...' : 'Run'}
                    </button>
                )}
                <button onClick={onClose} className="p-2 rounded-md text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors">
                    <XMarkIcon className="w-5 h-5" />
                </button>
            </div>
        </header>
        
        <nav className="flex items-stretch px-2 border-b border-border bg-surface/50">
            <TabButton tab="editor"><CodeBracketIcon className="w-4 h-4"/> Editor</TabButton>
            <TabButton tab="preview" disabled={!isWebPreview}><EyeIcon className="w-4 h-4" /> Preview</TabButton>
            <TabButton tab="console"><TerminalIcon className="w-4 h-4" /> Console</TabButton>
            {language === 'python-api' && <TabButton tab="api"><BoltIcon className="w-4 h-4" /> API Runner</TabButton>}
        </nav>
        
        <main className="flex-1 bg-background overflow-auto">
            {activeTab === 'editor' && (
                 <textarea value={code} onChange={(e) => onCodeUpdate(e.target.value)} className="w-full h-full bg-transparent text-text-primary p-4 resize-none font-mono text-sm leading-6 focus:outline-none" spellCheck="false"/>
            )}
            {activeTab === 'preview' && isWebPreview && (
              <div className="flex flex-col h-full bg-background">
                  <div className="flex items-center gap-2 p-1.5 border-b border-border bg-surface flex-shrink-0">
                      <div className="flex items-center gap-1 p-0.5 bg-background rounded-md border border-border">
                          <button onClick={() => setDevice('none')} className={`p-1.5 rounded-md transition-colors ${device === 'none' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}><ComputerDesktopIcon className="w-5 h-5" /></button>
                          <button onClick={() => setDevice('phone')} className={`p-1.5 rounded-md transition-colors ${device === 'phone' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}><DevicePhoneMobileIcon className="w-5 h-5" /></button>
                          <button onClick={() => setDevice('tablet')} className={`p-1.5 rounded-md transition-colors ${device === 'tablet' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}><DeviceTabletIcon className="w-5 h-5" /></button>
                      </div>
                      {device !== 'none' && ( <button onClick={() => setOrientation(p => p === 'portrait' ? 'landscape' : 'portrait')} className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors"><RotateCwIcon className="w-5 h-5" /></button> )}
                      <div className="flex-grow" />
                      <button id="preview-panel-refresh-button" onClick={() => setRefreshKey(k => k + 1)} className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors"><RefreshIcon className="w-5 h-5" /></button>
                      <button onClick={() => setIsPanelFullscreen(p => !p)} className="p-2 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors">
                          {isPanelFullscreen ? <CollapseIcon className="w-5 h-5" /> : <ExpandIcon className="w-5 h-5" />}
                      </button>
                  </div>
                  <div className={`flex-1 flex items-center justify-center p-4 sm:p-8 overflow-auto bg-black/20`}>
                      <div className={`transition-all duration-300 ease-in-out flex-shrink-0 
                        ${device === 'none' ? 'w-full h-full bg-white shadow-2xl shadow-black/50' : ''} 
                        ${device === 'phone' ? phoneFrameClass : ''}
                        ${device === 'tablet' ? `border-[16px] border-black rounded-[2.5rem] bg-black shadow-2xl shadow-black/50 ${orientation === 'portrait' ? 'w-[768px] h-[1024px]' : 'w-[1024px] h-[768px]'}` : ''}`}>
                          <iframe key={refreshKey} srcDoc={srcDoc} title="Preview" sandbox="allow-scripts allow-modals" className="w-full h-full border-0 bg-white" style={device !== 'none' ? { borderRadius: '1.5rem' } : {}}/>
                      </div>
                  </div>
              </div>
            )}
            {activeTab === 'console' && (
                 <div data-context-menu-id="preview-console" className="w-full h-full p-4 font-mono text-xs text-text-secondary overflow-y-auto">
                    {consoleOutput.map((line, index) => (
                        <div key={index} className="group flex items-start gap-2 justify-between hover:bg-surface/50 -mx-4 px-4 py-0.5 rounded-md">
                          <pre className={`whitespace-pre-wrap flex-1 ${line.type === 'error' ? 'text-red-400' : line.type === 'info' ? 'text-blue-300' : ''}`}>
                              <span className="select-none text-text-tertiary mr-2">{'>'}</span>{line.message}
                          </pre>
                          {line.type === 'error' && (
                              <button
                                  onClick={() => onAutoFixRequest(line.message, code, language)}
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
            {activeTab === 'api' && language === 'python-api' && (
              <ApiRunner endpoints={apiEndpoints} onRun={handleApiCall} responses={apiResponses} isRunning={isRunning} />
            )}
        </main>
      </div>
  );
};
