import React from 'react';
import { BoltIcon } from './icons';
import { Chat } from '../types';

interface ErrorAnalysisBannerProps {
  consoleOutput: NonNullable<Chat['sandboxState']>['consoleOutput'];
  onFixRequest: () => void;
}

export const ErrorAnalysisBanner: React.FC<ErrorAnalysisBannerProps> = ({ consoleOutput, onFixRequest }) => {
  const errorCount = consoleOutput?.filter(line => line.type === 'error').length || 0;

  if (errorCount === 0) {
    return null;
  }

  return (
    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 flex items-center justify-between gap-4 animate-slide-down-and-fade">
      <div className="text-sm">
        <p className="font-semibold text-yellow-300">Console Errors Detected</p>
        <p className="text-yellow-400/80">Gemini has analyzed {errorCount} error{errorCount > 1 ? 's' : ''} and can attempt to fix them.</p>
      </div>
      <button
        onClick={onFixRequest}
        className="flex items-center gap-2 text-sm bg-yellow-400/20 text-yellow-300 font-medium px-4 py-2 rounded-lg hover:bg-yellow-400/30 transition-colors flex-shrink-0"
      >
        <BoltIcon className="w-4 h-4" />
        Auto-Fix Errors
      </button>
    </div>
  );
};
