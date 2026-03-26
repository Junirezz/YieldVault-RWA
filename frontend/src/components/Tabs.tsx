import React, { createContext, useContext, useState, useEffect } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import "./Tabs.css";

interface TabsContextType {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs components must be used within a Tabs provider");
  }
  return context;
}

interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  syncWithUrl?: boolean;
  urlParam?: string;
  children: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  syncWithUrl = false,
  urlParam = "tab",
  children,
  className = "",
}: TabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalValue, setInternalValue] = useState(defaultValue || "");

  const urlValue = syncWithUrl ? searchParams.get(urlParam) : null;
  const activeValue =
    controlledValue !== undefined
      ? controlledValue
      : syncWithUrl && urlValue
      ? urlValue
      : internalValue;

  useEffect(() => {
    // If we're syncing with URL but the param isn't there, and we have a defaultValue,
    // let's set the default value in the URL implicitly, or just let activeValue handle it.
    // Setting it explicitly ensures deep links are predictable.
    if (syncWithUrl && !urlValue && defaultValue) {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set(urlParam, defaultValue);
          return newParams;
        },
        { replace: true }
      );
    }
  }, [syncWithUrl, urlValue, defaultValue, urlParam, setSearchParams]);

  const handleValueChange = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
    }

    if (syncWithUrl) {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set(urlParam, newValue);
          return newParams;
        },
        { replace: true }
      );
    }

    if (onValueChange) {
      onValueChange(newValue);
    }
  };

  return (
    <TabsContext.Provider value={{ value: activeValue, onValueChange: handleValueChange }}>
      <div className={`tabs-root ${className}`} data-state={activeValue}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={`tabs-list ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, children, className = "" }: { value: string; children: ReactNode; className?: string }) {
  const { value: activeValue, onValueChange } = useTabs();
  const isActive = activeValue === value;

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const parent = e.currentTarget.closest('[role="tablist"]');
    if (!parent) return;

    const tabs = Array.from(parent.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
    const index = tabs.indexOf(e.currentTarget);
    if (index === -1) return;

    let nextIndex = index;
    if (e.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    tabs[nextIndex].focus();
    onValueChange(tabs[nextIndex].dataset.value!);
  };

  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-${value}`}
      id={`tab-${value}`}
      data-state={isActive ? "active" : "inactive"}
      data-value={value}
      tabIndex={isActive ? 0 : -1}
      className={`tabs-trigger ${isActive ? "active" : ""} ${className}`}
      onClick={() => onValueChange(value)}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children, className = "" }: { value: string; children: ReactNode; className?: string }) {
  const { value: activeValue } = useTabs();
  const isActive = activeValue === value;

  if (!isActive) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      data-state={isActive ? "active" : "inactive"}
      className={`tabs-content ${className}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
