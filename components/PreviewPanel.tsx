import React, { useState, useEffect, useCallback, useRef } from 'react';
import { XMarkIcon, CodeBracketIcon, EyeIcon, TerminalIcon, PlayIcon, BoltIcon } from './icons';

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
  // (Implementation remains the same as before)
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
        <style>body { font-family: sans-serif; margin: 0; padding: 1rem; background-color: #18191B; color: #f1f5f9; }</style>
    </head><body><div id="root"></div><script type="text/babel">
        var process = { env: { NODE_ENV: 'development' } };
        (function() { ${consoleInterceptor}; ${codeBody}; ${renderLogic}; })();
    </script></body></html>`;
  }
  return 'Unsupported language for preview.';
};

type Tab = 'preview' | 'code' | 'console' | 'api';
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
  const initialTab: Tab = isPython ? (language === 'python-api' ? 'api' : 'code') : 'preview';

  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [editedCode, setEditedCode] = useState(code);
  const [srcDoc, setSrcDoc] = useState('');
  const [consoleOutput, setConsoleOutput] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const pyodideRef = useRef<any>(null);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  
  // API Runner state
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiResponses, setApiResponses] = useState<ApiResponses>({});

  useEffect(() => {
    const initPyodide = async () => {
      setConsoleOutput(['Initializing Python environment...']);
      if (activeTab !== 'console') setActiveTab('console');
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
  }, [isPython, activeTab]);

  useEffect(() => {
    setEditedCode(code);
    setConsoleOutput([]);
    setApiResponses({});
    setActiveTab(initialTab);
  }, [code, language]);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      if (language === 'jsx' || language === 'html') setSrcDoc(buildSrcDoc(editedCode, language));
      if (language === 'python-api') setApiEndpoints(parsePythonFunctions(editedCode));
    }, 250);
    return () => clearTimeout(handler);
  }, [editedCode, language]);

  useEffect(() => {
    const handleIframeMessages = (event: MessageEvent) => {
      if (event.data?.source === 'preview-iframe') {
        setConsoleOutput(prev => [...prev, `[IFRAME:${event.data.type.toUpperCase()}] ${event.data.payload}`]);
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
    setConsoleOutput([`Running Python script...`]);
    if(activeTab !== 'console') setActiveTab('console');
    runPython(editedCode);
  };
  
  const handleApiCall = async (endpointName: string, args: FormValues) => {
    setApiResponses(prev => ({ ...prev, [endpointName]: 'Running...' }));
    
    // Ensure the functions from the editor are loaded in the Pyodide environment
    await runPython(editedCode);

    const argString = Object.entries(args)
      .map(([key, value]) => {
        const endpoint = apiEndpoints.find(e => e.name === endpointName);
        const argType = endpoint?.args.find(a => a.name === key)?.type || 'any';
        if (typeof value === 'string' && !(argType.includes('int') || argType.includes('float'))) {
          return `${key}="${value.replace(/"/g, '\\"')}"`;
        }
        return `${key}=${value}`;
      })
      .join(', ');
      
    const callCode = `import json\njson.dumps(${endpointName}(${argString}))`;
    const resultJson = await runPython(callCode);
    
    try {
        const responseData = resultJson ? JSON.parse(resultJson) : { error: 'No return value from function.' };
        setApiResponses(prev => ({ ...prev, [endpointName]: responseData }));
    } catch (e) {
        setApiResponses(prev => ({ ...prev, [endpointName]: { error: 'Failed to parse response.', details: (e as Error).message, raw: resultJson } }));
    }
  };


  const TabButton: React.FC<{ tab: Tab, children: React.ReactNode, disabled?: boolean }> = ({ tab, children, disabled }) => (
    <button onClick={() => setActiveTab(tab)} disabled={disabled} className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${ activeTab === tab ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary' }`} aria-pressed={activeTab === tab}>
      {children}
    </button>
  );

  return (
    <div className="flex flex-col w-1/2 max-w-[50%] bg-surface/50 border-l border-border animate-fade-in backdrop-blur-sm">
      <header className="flex items-center justify-between p-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1">
          {language === 'python-api' && <TabButton tab="api"><BoltIcon className="w-4 h-4" /> API</TabButton>}
          <TabButton tab="preview" disabled={isPython}><EyeIcon className="w-4 h-4" /> Preview</TabButton>
          <TabButton tab="code"><CodeBracketIcon className="w-4 h-4" /> Code</TabButton>
          <TabButton tab="console"><TerminalIcon className="w-4 h-4" /> Console</TabButton>
        </div>
        <div className="flex items-center gap-2">
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
      
      <main className="flex-1 overflow-hidden bg-background">
        {activeTab === 'api' && language === 'python-api' && (
            <ApiRunner endpoints={apiEndpoints} onRun={handleApiCall} responses={apiResponses} isRunning={isRunning} />
        )}
        {activeTab === 'code' && (
          <textarea value={editedCode} onChange={(e) => setEditedCode(e.target.value)} className="w-full h-full bg-transparent text-text-primary p-4 resize-none font-mono text-sm focus:outline-none" spellCheck="false" aria-label="Code Editor"/>
        )}
        {activeTab === 'preview' && !isPython && (
          <iframe srcDoc={srcDoc} title="Preview" sandbox="allow-scripts allow-modals" className="w-full h-full border-0" aria-label="Code Preview"/>
        )}
        {activeTab === 'console' && (
            <div className="w-full h-full p-4 font-mono text-sm text-text-secondary overflow-y-auto">
                {consoleOutput.map((line, index) => (
                    <pre key={index} className={`whitespace-pre-wrap ${line.startsWith('[ERROR]') || line.startsWith('[CRITICAL') ? 'text-red-400' : ''}`}>
                        {`> ${line}`}
                    </pre>
                ))}
            </div>
        )}
      </main>
    </div>
  );
};