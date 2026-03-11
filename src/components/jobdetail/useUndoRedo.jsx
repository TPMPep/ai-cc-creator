import { useState, useCallback, useRef } from "react";

export default function useUndoRedo(initialState, maxHistory = 50) {
  const [history, setHistory] = useState([initialState]);
  const [pointer, setPointer] = useState(0);
  const skipNextPush = useRef(false);

  const current = history[pointer];

  const push = useCallback((newState) => {
    if (skipNextPush.current) {
      skipNextPush.current = false;
      return;
    }
    setHistory(prev => {
      const trimmed = prev.slice(0, pointer + 1);
      const next = [...trimmed, newState];
      if (next.length > maxHistory) next.shift();
      return next;
    });
    setPointer(prev => Math.min(prev + 1, maxHistory - 1));
  }, [pointer, maxHistory]);

  const undo = useCallback(() => {
    setPointer(prev => Math.max(0, prev - 1));
  }, []);

  const redo = useCallback(() => {
    setPointer(prev => Math.min(history.length - 1, prev + 1));
  }, [history.length]);

  const canUndo = pointer > 0;
  const canRedo = pointer < history.length - 1;

  const reset = useCallback((state) => {
    setHistory([state]);
    setPointer(0);
  }, []);

  return { current, push, undo, redo, canUndo, canRedo, reset };
}