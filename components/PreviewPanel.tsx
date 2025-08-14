import React, { useState, useEffect, useCallback, useRef } from 'react';
import { XMarkIcon, CodeBracketIcon, EyeIcon, TerminalIcon, PlayIcon, BoltIcon, Html5Icon, ReactIcon, PythonIcon, ComputerDesktopIcon, DevicePhoneMobileIcon, DeviceTabletIcon, RefreshIcon, RotateCwIcon, ExpandIcon, CollapseIcon, CheckIcon } from './icons';
import { analyzeAndFixCode } from '../services/geminiService';

interface PreviewPanelProps {
  code: string;
  language: string;
  onClose: () => void;
  onCodeUpdate: (newCode: string) => void;
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
    
    // More robust component detection
    const componentMatches = [...codeBody.matchAll(/(?:function|class)\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=\s*(?:function|\()/g)];
    const componentNames = componentMatches.map(m => m[1] || m[2]).filter(Boolean);
    const componentNameToRender = componentNames.length > 0 ? componentNames[componentNames.length - 1] : null;

    const renderLogic = componentNameToRender ? `
        try {
          const container = document.getElementById('root');
          const root = ReactDOM.createRoot(container);
          root.render(React.createElement(${componentNameToRender}));
        } catch(e) { console.error(e); }
      ` : `<div style="padding: 20px; text-align: center; color: #888; font-family: sans-serif; font-size: 16px;"><strong>Error: Could not find a React component to render.</strong><br>Please ensure your file contains a component with a PascalCase name (e.g., <code>function MyComponent() {}</code>) that can be rendered.</div>`;

    const consoleInterceptor = `
      const formatArg = (arg) => {
        if (arg instanceof Error) {
          return \`Error: \${arg.message}\\n\${arg.stack}\`;
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch (e) {
            return String(arg);
          }
        }
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
      window.addEventListener('error', e => postMsg('error', [e.message, e.filename, e.lineno]));
      window.addEventListener('unhandledrejection', e => postMsg('error', ['Unhandled Promise Rejection:', e.reason]));
    `;
    return `<!DOCTYPE html><html><head>
        <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
        <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
        <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
        <style>body { font-family: sans-serif; margin: 0; background-color: white; color: black; }</style>
    </head><body><div id="root"></div><script type="text/babel">
        var process = { env: { NODE_ENV: 'development' } };
        (function() { ${consoleInterceptor}; ${codeBody}; ${renderLogic}; })();
    </script></body></html>`;
  }
  return 'Unsupported language for preview.';
};

type ActiveTab = 'editor' | 'preview' | 'console' | 'api';
interface ApiEndpoint { name: string; args: { name: string; type: string }[]; }
interface FormValues { [key: string]: string | number; }
interface ApiResponses { [key: string]: any; }
type FixableError = { message: string; type: 'console' | 'preview' };

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
        return <div className="p-4 text-text-secondary text-center">No API functions found in the code. Run the code to load them.</div>
    }

    return (
        <div className="p-4 space-y-6">
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

const AnalysisNotification: React.FC<{
    fixableError: FixableError | null;
    analysis: { explanation: string; fixedCode: string } | null;
    isAnalyzing: boolean;
    onAnalyze: () => void;
    onApply: () => void;
    onDiscard: () => void;
}> = ({ fixableError, analysis, isAnalyzing, onAnalyze, onApply, onDiscard }) => {
    if (isAnalyzing) {
        return (
            <div className="p-3 border-b border-blue-400/30 bg-blue-900/30 flex items-center gap-4 animate-fade-in">
                <p className="text-sm text-blue-300 animate-pulse flex-1">
                    <BoltIcon className="w-4 h-4 inline-block mr-2" />
                    AI is analyzing the error...
                </p>
            </div>
        );
    }

    if (analysis) {
        return (
            <div className="p-3 border-b border-green-400/30 bg-green-900/30 animate-fade-in">
                <p className="text-sm text-green-200 mb-2">
                    <strong className="font-semibold text-green-100">AI Analysis:</strong> {analysis.explanation}
                </p>
                <div className="flex items-center justify-end gap-3 mt-2">
                     <button onClick={onDiscard} className="text-xs text-text-secondary hover:text-text-primary transition-colors">Discard</button>
                    <button onClick={onApply} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors bg-accent-hover text-text-primary hover:bg-border">
                        <CheckIcon className="w-4 h-4" />
                        Apply Fix
                    </button>
                </div>
            </div>
        );
    }
    
    if (fixableError) {
         return (
            <div className="p-3 border-b border-red-400/30 bg-red-900/30 flex items-center justify-between gap-4 animate-fade-in">
                <p className="text-sm text-red-300/90 truncate flex-1">
                    <strong className="font-semibold">Error detected:</strong> {fixableError.message}
                </p>
                <button 
                    onClick={onAnalyze}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors bg-accent-hover text-text-primary hover:bg-border flex-shrink-0"
                >
                    <BoltIcon className="w-4 h-4"/>
                    Analyze with AI
                </button>
            </div>
        );
    }

    return null;
};


// --- Main Panel Component ---

export const PreviewPanel: React.FC<PreviewPanelProps> = ({ code, language, onClose, onCodeUpdate }) => {
  const isPython = language === 'python' || language === 'python-api';
  const initialTab: ActiveTab = isPython ? 'editor' : 'preview';

  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [editorCode, setEditorCode] = useState(code);
  const [srcDoc, setSrcDoc] = useState('');
  const [consoleOutput, setConsoleOutput] = useState<{ type: string; message: string }[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const pyodideRef = useRef<any>(null);
  const [isPyodideReady, setIsPyodideReady] = useState(false);
  
  const [apiEndpoints, setApiEndpoints] = useState<ApiEndpoint[]>([]);
  const [apiResponses, setApiResponses] = useState<ApiResponses>({});
  
  const [device, setDevice] = useState<'none' | 'phone' | 'tablet'>('none');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isPanelFullscreen, setIsPanelFullscreen] = useState(false);
  
  const [fixableError, setFixableError] = useState<FixableError | null>(null);
  const [analysis, setAnalysis] = useState<{ explanation: string, fixedCode: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const hasAutoRun = useRef(false);

  const toggleOrientation = () => setOrientation(prev => prev === 'portrait' ? 'landscape' : 'portrait');

  const handleToggleFullscreen = () => setIsPanelFullscreen(prev => !prev);

  useEffect(() => {
    const initPyodide = async () => {
      setConsoleOutput([{ type: 'info', message: 'Initializing Python environment...' }]);
      try {
        const pyodide = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });
        setConsoleOutput(prev => [...prev, { type: 'info', message: 'Loading numpy and pandas...' }]);
        await pyodide.loadPackage(['numpy', 'pandas']);
        pyodideRef.current = pyodide;
        setIsPyodideReady(true);
        setConsoleOutput(prev => [...prev, { type: 'info', message: 'Python environment ready.' }]);
      } catch (error) {
        console.error("Pyodide loading failed:", error);
        setConsoleOutput(prev => [...prev, { type: 'error', message: `Failed to initialize Python environment. ${(error as Error).message}` }]);
      }
    };
    if (isPython && !pyodideRef.current) {
      initPyodide();
    }
  }, [isPython]);

  useEffect(() => {
    setEditorCode(code);
    hasAutoRun.current = false; // Reset auto-run tracker
    setConsoleOutput([]);
    setApiResponses({});
    setActiveTab(initialTab);
    setDevice('none');
    setOrientation('portrait');
    setApiEndpoints(language === 'python-api' ? parsePythonFunctions(code) : []);
    setFixableError(null);
    setAnalysis(null);
    setIsAnalyzing(false);
  }, [code, language, initialTab]);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      if (language === 'jsx' || language === 'html') setSrcDoc(buildSrcDoc(editorCode, language));
    }, 250);
    return () => clearTimeout(handler);
  }, [editorCode, language]);

  useEffect(() => {
    const handleIframeMessages = (event: MessageEvent) => {
      if (event.data?.source === 'preview-iframe') {
        setActiveTab('console');
        const { type, payload } = event.data;
        setConsoleOutput(prev => [...prev, { type: type, message: `[PREVIEW] ${payload}` }]);
        if (type === 'error') {
            setFixableError({ message: payload, type: 'preview' });
        }
      }
    };
    window.addEventListener('message', handleIframeMessages);
    return () => window.removeEventListener('message', handleIframeMessages);
  }, []);

  const runPython = useCallback(async (pyCode: string) => {
    if (!pyodideRef.current || !isPyodideReady) {
        setConsoleOutput(prev => [...prev, { type: 'error', message: `Python environment not ready.` }]);
        return null;
    }
    setIsRunning(true);
    let result = null;
    try {
      const pyodide = pyodideRef.current;
      pyodide.setStdout({ batched: (msg: string) => setConsoleOutput(prev => [...prev, { type: 'log', message: msg }]) });
      pyodide.setStderr({ batched: (msg: string) => {
        setConsoleOutput(prev => [...prev, { type: 'error', message: msg }]);
        setFixableError({ message: msg, type: 'console' });
      }});
      result = await pyodide.runPythonAsync(pyCode);
    } catch (err) {
      const errorMessage = (err as Error).message;
      setConsoleOutput(prev => [...prev, { type: 'error', message: `CRITICAL ERROR: ${errorMessage}` }]);
      setFixableError({ message: errorMessage, type: 'console' });
    } finally {
      setIsRunning(false);
    }
    return result;
  }, [isPyodideReady]);

  const handleRunCode = useCallback((codeToRun: string) => {
    if (!isPython || !isPyodideReady) return;
    setConsoleOutput([{ type: 'info', message: 'Running code...' }]);
    setFixableError(null);
    setAnalysis(null);
    setActiveTab('console');
    runPython(codeToRun).then(() => {
      if (language === 'python-api') {
        const endpoints = parsePythonFunctions(codeToRun);
        setApiEndpoints(endpoints);
        setConsoleOutput(prev => [...prev, { type: 'info', message: "API environment is ready." }]);
        if (endpoints.length > 0) {
            setConsoleOutput(prev => [...prev, { type: 'info', message: "Switched to API Runner tab." }]);
            setActiveTab('api');
        } else {
            setConsoleOutput(prev => [...prev, { type: 'warn', message: "No API functions found. Remained on Console tab." }]);
        }
      } else {
        setConsoleOutput(prev => [...prev, { type: 'info', message: "Script finished." }]);
      }
    });
  }, [isPython, isPyodideReady, language, runPython]);
  
  // Autorun python-api when the environment is ready
  useEffect(() => {
    if (language === 'python-api' && isPyodideReady && !hasAutoRun.current) {
      hasAutoRun.current = true;
      handleRunCode(code);
    }
  }, [isPyodideReady, language, code, handleRunCode]);

  const handleApiCall = async (endpointName: string, args: FormValues) => {
    setActiveTab('console');
    setApiResponses(prev => ({ ...prev, [endpointName]: 'Running...' }));
    
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
  
  const handleAnalyzeAndFix = useCallback(async () => {
    if (!fixableError) return;
    setIsAnalyzing(true);
    setAnalysis(null);
    setConsoleOutput(prev => [...prev, { type: 'info', message: '[AI] Analyzing the error...' }]);
    try {
        const result = await analyzeAndFixCode(editorCode, language, fixableError.message);
        setAnalysis(result);
        setConsoleOutput(prev => [...prev, { type: 'info', message: '[AI] Analysis complete. Review the proposed fix.' }]);
    } catch (error) {
        console.error('Analysis failed:', error);
        setConsoleOutput(prev => [...prev, { type: 'error', message: `[AI] Analysis failed: ${(error as Error).message}` }]);
        setFixableError(null);
    } finally {
        setIsAnalyzing(false);
    }
  }, [editorCode, language, fixableError]);

  const applyFix = () => {
    if (!analysis) return;
    onCodeUpdate(analysis.fixedCode);
    setAnalysis(null);
    setFixableError(null);
    setConsoleOutput(prev => [...prev, { type: 'info', message: '[AI] Fix applied.' }]);
  };

  const discardFix = () => {
    setAnalysis(null);
  };
  
  const handleEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditorCode(e.target.value);
    if (fixableError) {
        setFixableError(null);
        setAnalysis(null);
    }
  };

  const handleRefresh = () => setRefreshKey(k => k + 1);
  
  const TabButton: React.FC<{ tab: ActiveTab, children: React.ReactNode, disabled?: boolean }> = ({ tab, children, disabled }) => (
    <button onClick={() => setActiveTab(tab)} disabled={disabled} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-b-2 ${ activeTab === tab ? 'border-accent text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary' }`} aria-pressed={activeTab === tab}>
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
    <div className={`flex flex-col w-full bg-surface border-l border-border animate-fade-in
                   ${isPanelFullscreen 
                     ? 'fixed inset-0 z-50' 
                     : 'md:relative md:inset-auto md:z-auto md:w-1/2 md:max-w-[50%]'
                   } overflow-hidden`}>
        
        <header className="flex items-center justify-between pl-3 pr-2 h-10 border-b border-border flex-shrink-0 bg-background">
            <div className="flex items-center gap-2">
                {langIcon}
                <span className="text-sm text-text-primary font-medium">{langName}</span>
            </div>
            <div className="flex items-center gap-1">
                 {isPython && (
                    <button onClick={() => handleRunCode(editorCode)} disabled={!isPyodideReady || isRunning} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors bg-green-600/20 text-green-400 hover:bg-green-600/40 disabled:opacity-50 disabled:cursor-wait">
                        <PlayIcon className="w-4 h-4"/>
                        {isRunning ? 'Running...' : 'Run'}
                    </button>
                )}
                <button onClick={onClose} className="p-1.5 rounded-md text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors" aria-label="Close Sandbox">
                    <XMarkIcon className="w-5 h-5" />
                </button>
            </div>
        </header>
        
        <AnalysisNotification 
            fixableError={fixableError}
            analysis={analysis}
            isAnalyzing={isAnalyzing}
            onAnalyze={handleAnalyzeAndFix}
            onApply={applyFix}
            onDiscard={discardFix}
        />

        <nav className="flex items-stretch px-2 border-b border-border bg-surface">
            <TabButton tab="editor"><CodeBracketIcon className="w-4 h-4"/> Editor</TabButton>
            <TabButton tab="preview" disabled={isPython}><EyeIcon className="w-4 h-4" /> Preview</TabButton>
            <TabButton tab="console"><TerminalIcon className="w-4 h-4" /> Console</TabButton>
            {language === 'python-api' && <TabButton tab="api"><BoltIcon className="w-4 h-4" /> API Runner</TabButton>}
        </nav>
        
        <main className="flex-1 bg-background overflow-auto">
            {activeTab === 'editor' && (
                <textarea value={editorCode} onChange={handleEditorChange} onBlur={() => onCodeUpdate(editorCode)} className="w-full h-full bg-transparent text-text-primary p-4 resize-none font-mono text-sm leading-6 focus:outline-none" spellCheck="false" aria-label="Code Editor"/>
            )}
            
            {activeTab === 'preview' && !isPython && (
              <div className="flex flex-col h-full bg-background">
                  <div className="flex items-center gap-3 p-1.5 border-b border-border bg-surface flex-shrink-0">
                      <div className="flex items-center gap-1 p-0.5 bg-background rounded-md border border-border">
                          <button onClick={() => setDevice('none')} title="Desktop" className={`p-1 rounded-md transition-colors ${device === 'none' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'}`} aria-pressed={device === 'none'}><ComputerDesktopIcon className="w-5 h-5" /></button>
                          <button onClick={() => setDevice('phone')} title="Phone" className={`p-1 rounded-md transition-colors ${device === 'phone' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'}`} aria-pressed={device === 'phone'}><DevicePhoneMobileIcon className="w-5 h-5" /></button>
                          <button onClick={() => setDevice('tablet')} title="Tablet" className={`p-1 rounded-md transition-colors ${device === 'tablet' ? 'bg-accent-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'}`} aria-pressed={device === 'tablet'}><DeviceTabletIcon className="w-5 h-5" /></button>
                      </div>
                      {device !== 'none' && ( <button onClick={toggleOrientation} title="Rotate" className="p-1.5 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors" aria-label="Toggle orientation"><RotateCwIcon className="w-5 h-5" /></button> )}
                      <div className="flex-grow" />
                      <button onClick={handleRefresh} title="Refresh Preview" className="p-1.5 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors" aria-label="Refresh Preview"><RefreshIcon className="w-5 h-5" /></button>
                      <button onClick={handleToggleFullscreen} title={isPanelFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'} className="p-1.5 rounded-full text-text-secondary hover:bg-accent-hover hover:text-text-primary transition-colors" aria-label={isPanelFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}>
                          {isPanelFullscreen ? <CollapseIcon className="w-5 h-5" /> : <ExpandIcon className="w-5 h-5" />}
                      </button>
                  </div>
                  <div className={`flex-1 flex items-center justify-center p-4 sm:p-8 overflow-auto bg-black/20`}>
                      <div className={`relative bg-white shadow-2xl shadow-black/50 transition-all duration-300 ease-in-out flex-shrink-0 ${device === 'none' ? 'w-full h-full' : 'border-black rounded-[2.5rem]'} ${device === 'phone' ? `border-[14px] ${orientation === 'portrait' ? 'w-[375px] h-[667px]' : 'w-[667px] h-[375px]'}` : ''} ${device === 'tablet' ? `border-[16px] ${orientation === 'portrait' ? 'w-[768px] h-[1024px]' : 'w-[1024px] h-[768px]'}` : ''}`}>
                          <iframe key={refreshKey} srcDoc={srcDoc} title="Preview" sandbox="allow-scripts allow-modals" className="w-full h-full border-0 bg-white" style={device !== 'none' ? { borderRadius: '1.5rem' } : {}} aria-label="Code Preview" />
                          {device !== 'none' && (<div className={`absolute bg-black z-10 ${orientation === 'portrait' ? 'left-1/2 -translate-x-1/2 -top-[1px] h-7 w-1/3 rounded-b-xl' : 'top-1/2 -translate-y-1/2 -left-[1px] w-7 h-1/4 rounded-r-xl'}`}></div>)}
                      </div>
                  </div>
              </div>
            )}
            
            {activeTab === 'console' && (
                <div className="w-full h-full p-4 font-mono text-xs text-text-secondary overflow-y-auto">
                    {consoleOutput.map((line, index) => (
                        <pre key={index} className={`whitespace-pre-wrap ${line.type === 'error' ? 'text-red-400' : line.type === 'info' ? 'text-blue-300' : ''}`}>
                            <span className="select-none text-text-tertiary mr-2">{'>'}</span>{line.message}
                        </pre>
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