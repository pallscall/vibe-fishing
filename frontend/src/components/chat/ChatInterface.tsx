'use client'

import React, { useRef, useState, useEffect } from 'react'
import { Send, User, Bot, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      createdAt: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage.content }),
      })

      if (!response.ok) throw new Error('Failed to send message')

      const data = await response.json()
      
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || 'No response from server',
        createdAt: Date.now(),
      }

      setMessages((prev) => [...prev, botMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, something went wrong. Please check if the backend is running.',
        createdAt: Date.now(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] w-full max-w-5xl mx-auto border rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500">
            <Bot className="w-12 h-12 mb-4 opacity-50" />
            <p>Start a conversation with Vibe Fishing</p>
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex w-full",
              message.role === 'user' ? "justify-end" : "justify-start"
            )}
          >
            <div
              className={cn(
                "flex max-w-[80%] rounded-lg p-4 gap-3",
                message.role === 'user' 
                  ? "bg-blue-600 text-white" 
                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
              )}
            >
              <div className="shrink-0 mt-1">
                {message.role === 'user' ? <User size={18} /> : <Bot size={18} />}
              </div>
              <div className="prose prose-sm dark:prose-invert break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start w-full">
             <div className="flex max-w-[80%] rounded-lg p-4 gap-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
               <div className="shrink-0 mt-1">
                 <Bot size={18} />
               </div>
               <div className="flex items-center">
                 <Loader2 className="h-4 w-4 animate-spin" />
                 <span className="ml-2 text-sm">Thinking...</span>
               </div>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t bg-zinc-50 dark:bg-zinc-900/50">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="resize-none min-h-[50px] max-h-[200px]"
          />
          <Button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            className="h-[50px] w-[50px] shrink-0"
          >
            <Send size={20} />
          </Button>
        </form>
      </div>
    </div>
  )
}
