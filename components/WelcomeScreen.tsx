import React from 'react';
import { SparklesIcon } from './icons';

interface WelcomeScreenProps {
  onPromptClick: (prompt: string, files: File[], isSearchActive: boolean) => void;
}

const suggestionPrompts = [
    {
        heading: "Write code for a",
        message: "React counter component"
    },
    {
        heading: "Explain the latest trend",
        message: "in frontend development"
    },
    {
        heading: "Brainstorm three names",
        message: "for a new tech startup"
    },
    {
        heading: "Explain quantum computing",
        message: "in simple terms"
    }
];

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onPromptClick }) => {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4 animate-fade-in">
            <div className="w-16 h-16 bg-surface border border-border rounded-full flex items-center justify-center mb-6 animate-scale-in">
                <SparklesIcon className="w-8 h-8 text-accent" />
            </div>
            <h1 className="text-3xl font-semibold text-text-primary mb-6 animate-slide-down-and-fade" style={{ animationDelay: '100ms' }}>
                How can I help you today?
            </h1>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                {suggestionPrompts.map((prompt, index) => (
                    <button
                        key={prompt.heading}
                        onClick={() => onPromptClick(`${prompt.heading} ${prompt.message}`, [], false)}
                        className="bg-surface border border-border rounded-lg p-4 text-left hover:bg-accent-hover hover:-translate-y-1 transition-all duration-200 animate-slide-up-and-fade"
                        style={{ animationDelay: `${200 + index * 100}ms`, animationFillMode: 'backwards' }}
                    >
                        <p className="text-sm font-semibold text-text-primary">{prompt.heading}</p>
                        <p className="text-sm text-text-secondary">{prompt.message}</p>
                    </button>
                ))}
            </div>
        </div>
    );
};
