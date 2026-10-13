import { createContext } from 'preact';

// Pending permission requests by tool_use id, so any tool card (including nested subagent steps)
// can show the prompt that belongs to it.
export const ChatContext = createContext({ permissions: {} });
