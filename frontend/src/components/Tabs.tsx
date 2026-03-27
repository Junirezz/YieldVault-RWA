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

/** Inner component that uses useSearchParams — only rendered when syncWithUrl=true */
function TabsWithUrl({
  defaultValue,
  value: controlledValue,
  onValueChange,
  urlParam = "tab",
  children,
  className = "",
}: Omit<TabsProps, "syncWithUrl">) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalValue, setInternalValue] = useState(defaultValue || "");

  const urlValue = searchParams.get(urlParam);
  const activeValue =
    controlledValue !== undefined
      ? controlledValue
      : urlValue
      ? urlValue
      : internalValue;

  useEffect(() => {
    if (!urlValue && defaultValue) {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          newParams.set(urlParam, defaultValue);
          return newParams;
        },
        { replace: true }
      );
    }
  }, [urlValue, defaultValue, urlParam, setSearchParams]);

  const handleValueChange = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
    }

    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.set(urlParam, newValue);
        return newParams;
      },
      { replace: true }
    );

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

/** Inner component for tabs without URL sync */
function TabsWithoutUrl({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className = "",
}: Omit<TabsProps, "syncWithUrl" | "urlParam">) {
  const [internalValue, setInternalValue] = useState(defaultValue || "");

  const activeValue =
    controlledValue !== undefined ? controlledValue : internalValue;

  const handleValueChange = (newValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(newValue);
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

export function Tabs({
  syncWithUrl = false,
  ...props
}: TabsProps) {
  if (syncWithUrl) {
    return <TabsWithUrl {...props} />;
  }
  return <TabsWithoutUrl {...props} />;
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

    const tabs = Array.from(parent.querySelectorAll('button[data-value]')) as HTMLButtonElement[];
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
      type="button"
      aria-pressed={isActive}
      data-state={isActive ? "active" : "inactive"}
      data-value={value}
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
      data-state={isActive ? "active" : "inactive"}
      className={`tabs-content ${className}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
