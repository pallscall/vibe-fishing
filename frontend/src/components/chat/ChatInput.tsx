import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { SendHorizontal, Paperclip, ChevronDown, Zap, Brain, GraduationCap, Rocket, Layers, ListChecks, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModelOption } from '@/lib/types';

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  disabled?: boolean;
  modelOptions: ModelOption[];
  selectedModelId: string;
  onModelChange: (id: string) => void;
  mode: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing' | 'todo';
  modeOptions: Array<{
    value: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing' | 'todo';
    label: string;
    description: string;
  }>;
  onModeChange: (mode: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing' | 'todo') => void;
  selectedModeDescription: string;
  isModeDisabled?: boolean;
  isModelDisabled?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  disabled,
  modelOptions,
  selectedModelId,
  onModelChange,
  mode,
  modeOptions,
  onModeChange,
  selectedModeDescription,
  isModeDisabled,
  isModelDisabled,
}: ChatInputProps) {
  const [modeOpen, setModeOpen] = useState(false);
  const handleModeSelect = (value: 'flash' | 'thinking' | 'pro' | 'ultra' | 'vibefishing' | 'todo') => {
    onModeChange(value);
    setModeOpen(false);
  };
  const modeIconMap = {
    flash: <Zap className="h-4 w-4" />,
    thinking: <Brain className="h-4 w-4" />,
    pro: <GraduationCap className="h-4 w-4" />,
    ultra: <Rocket className="h-4 w-4" />,
    vibefishing: <Layers className="h-4 w-4" />,
    todo: <ListChecks className="h-4 w-4" />,
  };
  const activeMode = modeOptions.find((opt) => opt.value === mode);
  const [input, setInput] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !disabled) {
      onSend(input);
      setInput('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  };

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  return (
    <div className={cn(
      "relative rounded-2xl border transition-all duration-200 bg-white dark:bg-zinc-900 shadow-sm",
      isFocused 
        ? "border-emerald-500/50 shadow-[0_0_20px_-5px_rgba(16,185,129,0.1)] ring-1 ring-emerald-500/20" 
        : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
    )}>
      <form onSubmit={handleSubmit} className="flex flex-col">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Send a message... (use /skill <name>)"
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent border-none focus:ring-0 resize-none py-4 px-4 min-h-[56px] max-h-[200px] text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100"
        />
        
        <div className="flex flex-col gap-2 px-2 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg" disabled={disabled}>
                <Paperclip className="h-4 w-4" />
              </Button>
            </div>
            <div className="relative">
              <button
                type="button"
                className="h-8 pl-3 pr-8 rounded-full border border-zinc-200/80 dark:border-zinc-700/80 bg-white/80 dark:bg-zinc-950/40 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 shadow-sm shadow-zinc-900/5 dark:shadow-black/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 hover:bg-white/95 dark:hover:bg-zinc-900/60 transition-colors backdrop-blur-md flex items-center gap-2"
                onClick={() => setModeOpen((prev) => !prev)}
                disabled={isModeDisabled}
              >
                <span className="text-zinc-500 dark:text-zinc-400">{modeIconMap[mode]}</span>
                <span>{activeMode?.label ?? '模式'}</span>
                <ChevronDown className="ml-1 h-3 w-3 text-zinc-400" />
              </button>
              {modeOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setModeOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute left-0 bottom-10 z-50 w-72 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-[#fbf8f2] dark:bg-zinc-950/90 shadow-xl shadow-zinc-900/10 backdrop-blur-md p-2">
                    <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">模式</div>
                    <div className="space-y-1">
                      {modeOptions.map((opt) => {
                        const isActive = opt.value === mode;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => handleModeSelect(opt.value)}
                            className={cn(
                              "w-full rounded-xl px-3 py-2 text-left transition-colors flex items-start gap-3",
                              isActive
                                ? "bg-white/70 dark:bg-zinc-900/80 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                : "hover:bg-white/60 dark:hover:bg-zinc-900/60 text-zinc-600 dark:text-zinc-300"
                            )}
                          >
                            <div className={cn("mt-1 text-zinc-400", isActive && "text-zinc-800 dark:text-zinc-100")}>
                              {modeIconMap[opt.value]}
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-semibold">{opt.label}</div>
                              <div className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                                {opt.description}
                              </div>
                            </div>
                            {isActive && <div className="mt-1 text-zinc-500">✓</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <select
                  value={selectedModelId}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="h-8 pl-3 pr-8 rounded-full border border-zinc-200/80 dark:border-zinc-700/80 bg-white/80 dark:bg-zinc-950/40 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 shadow-sm shadow-zinc-900/5 dark:shadow-black/20 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 hover:bg-white/95 dark:hover:bg-zinc-900/60 transition-colors appearance-none backdrop-blur-md"
                  disabled={isModelDisabled}
                >
                  {modelOptions.length === 0 && <option value="">No models</option>}
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
              </div>
              {disabled ? (
                <Button
                  type="button"
                  size="icon"
                  onClick={onStop}
                  className="h-8 w-8 rounded-full bg-rose-600 text-white shadow-md shadow-rose-600/20 hover:bg-rose-700"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button 
                  type="submit" 
                  size="icon" 
                  disabled={!input.trim() || Boolean(isModelDisabled)}
                  className={cn(
                    "h-8 w-8 rounded-full transition-all duration-200",
                    input.trim() 
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20" 
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600"
                  )}
                >
                  <SendHorizontal className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          {selectedModeDescription && (
            <div className="px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              {selectedModeDescription}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
