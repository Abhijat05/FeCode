import React, { useState, useEffect, useRef } from "react";
import { Text, useInput, useStdin } from "ink";
import chalk from "chalk";
import {
  findWordBoundaryLeft,
  findWordBoundaryRight,
  deleteWordLeft,
  deleteWordRight,
  deleteBackward,
  deleteForward,
  killLineLeft,
  killLineRight,
  insertText,
  resolveKeyAction
} from "./textEditingUtils.js";

export interface EnhancedTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  mask?: string;
  highlightPastedText?: boolean;
  showCursor?: boolean;
}

export const EnhancedTextInput: React.FC<EnhancedTextInputProps> = ({
  value: originalValue,
  placeholder = "",
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onSubmit
}) => {
  const [cursorOffset, setCursorOffset] = useState((originalValue || "").length);
  const [cursorWidth, setCursorWidth] = useState(0);
  const [isAllSelected, setIsAllSelected] = useState(false);
  const { internal_eventEmitter } = useStdin();
  const lastRawInputRef = useRef<string>("");

  const originalValueRef = useRef(originalValue);
  originalValueRef.current = originalValue;
  const cursorOffsetRef = useRef(cursorOffset);
  cursorOffsetRef.current = cursorOffset;
  const isAllSelectedRef = useRef(isAllSelected);
  isAllSelectedRef.current = isAllSelected;

  const pasteBufferRef = useRef<string | null>(null);
  const pasteTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pasteTimerRef.current) {
        clearTimeout(pasteTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focus) return;
    const handleRaw = (data: string) => {
      if (typeof data === "string" && data.startsWith("\x1b")) {
        lastRawInputRef.current = data;
      }
    };
    internal_eventEmitter?.on("input", handleRaw);
    return () => {
      internal_eventEmitter?.removeListener("input", handleRaw);
    };
  }, [internal_eventEmitter, focus]);

  useEffect(() => {
    const val = originalValue || "";
    if (val.length === 0 && isAllSelected) {
      setIsAllSelected(false);
    }
    if (cursorOffset > val.length) {
      setCursorOffset(val.length);
      setCursorWidth(0);
    }
  }, [originalValue, cursorOffset, isAllSelected]);

  const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
  const displayValue = mask ? mask.repeat(originalValue.length) : originalValue;
  let renderedValue = displayValue;
  let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

  if (showCursor && focus) {
    if (isAllSelected && displayValue.length > 0) {
      renderedValue = chalk.inverse(displayValue);
    } else {
      renderedPlaceholder =
        placeholder.length > 0
          ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
          : chalk.inverse(" ");
      renderedValue = displayValue.length > 0 ? "" : chalk.inverse(" ");
      let i = 0;
      for (const char of displayValue) {
        const isCursor =
          i >= cursorOffset - cursorActualWidth && i <= cursorOffset;
        if (char === "\n") {
          renderedValue += isCursor ? chalk.inverse(" ") + "\n" : "\n";
        } else {
          renderedValue += isCursor ? chalk.inverse(char) : char;
        }
        i++;
      }
      if (displayValue.length > 0 && cursorOffset === displayValue.length) {
        renderedValue += chalk.inverse(" ");
      }
    }
  }

  useInput(
    (input, key) => {
      const effectiveInput = input || lastRawInputRef.current;
      lastRawInputRef.current = "";

      // Handle chunked bracketed paste sequences across multiple stdin events
      if (pasteBufferRef.current !== null) {
        if (pasteTimerRef.current) {
          clearTimeout(pasteTimerRef.current);
          pasteTimerRef.current = null;
        }
        pasteBufferRef.current += effectiveInput;
        if (pasteBufferRef.current.includes("[201~")) {
          const completePaste = pasteBufferRef.current;
          pasteBufferRef.current = null;
          if (isAllSelectedRef.current) {
            setIsAllSelected(false);
            setCursorOffset(completePaste.length);
            setCursorWidth(completePaste.length > 1 ? completePaste.length : 0);
            onChange(completePaste);
          } else {
            const res = insertText(
              originalValueRef.current,
              cursorOffsetRef.current,
              completePaste
            );
            setCursorOffset(res.offset);
            setCursorWidth(completePaste.length > 1 ? completePaste.length : 0);
            onChange(res.text);
          }
        } else {
          pasteTimerRef.current = setTimeout(() => {
            if (pasteBufferRef.current !== null) {
              const flushed = pasteBufferRef.current;
              pasteBufferRef.current = null;
              const res = insertText(
                originalValueRef.current,
                cursorOffsetRef.current,
                flushed
              );
              setCursorOffset(res.offset);
              setCursorWidth(flushed.length > 1 ? flushed.length : 0);
              onChange(res.text);
            }
          }, 300);
        }
        return;
      }

      if (effectiveInput.includes("[200~") && !effectiveInput.includes("[201~")) {
        pasteBufferRef.current = effectiveInput;
        pasteTimerRef.current = setTimeout(() => {
          if (pasteBufferRef.current !== null) {
            const flushed = pasteBufferRef.current;
            pasteBufferRef.current = null;
            const res = insertText(
              originalValueRef.current,
              cursorOffsetRef.current,
              flushed
            );
            setCursorOffset(res.offset);
            setCursorWidth(flushed.length > 1 ? flushed.length : 0);
            onChange(res.text);
          }
        }, 300);
        return;
      }

      const action = resolveKeyAction(effectiveInput, key);

      switch (action.type) {
        case "submit": {
          if (onSubmit) {
            onSubmit(originalValue);
          }
          break;
        }

        case "select_all": {
          if (originalValue.length === 0) {
            break;
          }
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
          } else {
            setIsAllSelected(true);
          }
          break;
        }

        case "home": {
          setIsAllSelected(false);
          setCursorOffset(0);
          break;
        }

        case "end": {
          setIsAllSelected(false);
          setCursorOffset(originalValue.length);
          break;
        }

        case "word_left": {
          setIsAllSelected(false);
          setCursorOffset(findWordBoundaryLeft(originalValue, cursorOffset));
          break;
        }

        case "word_right": {
          setIsAllSelected(false);
          setCursorOffset(findWordBoundaryRight(originalValue, cursorOffset));
          break;
        }

        case "char_left": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
          } else {
            setCursorOffset(Math.max(0, cursorOffset - 1));
          }
          break;
        }

        case "char_right": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(originalValue.length);
          } else {
            setCursorOffset(Math.min(originalValue.length, cursorOffset + 1));
          }
          break;
        }

        case "delete_word_left": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
            onChange("");
          } else {
            const res = deleteWordLeft(originalValue, cursorOffset);
            setCursorOffset(res.offset);
            if (res.text !== originalValue) {
              onChange(res.text);
            }
          }
          break;
        }

        case "delete_word_right": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
            onChange("");
          } else {
            const res = deleteWordRight(originalValue, cursorOffset);
            setCursorOffset(res.offset);
            if (res.text !== originalValue) {
              onChange(res.text);
            }
          }
          break;
        }

        case "delete_backward": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
            onChange("");
          } else {
            const res = deleteBackward(originalValue, cursorOffset);
            setCursorOffset(res.offset);
            if (res.text !== originalValue) {
              onChange(res.text);
            }
          }
          break;
        }

        case "delete_forward": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
            onChange("");
          } else {
            const res = deleteForward(originalValue, cursorOffset);
            setCursorOffset(res.offset);
            if (res.text !== originalValue) {
              onChange(res.text);
            }
          }
          break;
        }

        case "kill_line_left": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
            onChange("");
          } else {
            const res = killLineLeft(originalValue, cursorOffset);
            setCursorOffset(res.offset);
            if (res.text !== originalValue) {
              onChange(res.text);
            }
          }
          break;
        }

        case "kill_line_right": {
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(0);
            onChange("");
          } else {
            const res = killLineRight(originalValue, cursorOffset);
            setCursorOffset(res.offset);
            if (res.text !== originalValue) {
              onChange(res.text);
            }
          }
          break;
        }

        case "insert": {
          const inserted = action.text || "";
          if (isAllSelected) {
            setIsAllSelected(false);
            setCursorOffset(inserted.length);
            setCursorWidth(inserted.length > 1 ? inserted.length : 0);
            onChange(inserted);
          } else {
            const res = insertText(originalValue, cursorOffset, inserted);
            setCursorOffset(res.offset);
            setCursorWidth(inserted.length > 1 ? inserted.length : 0);
            onChange(res.text);
          }
          break;
        }

        case "escape": {
          if (isAllSelected) {
            setIsAllSelected(false);
          }
          break;
        }

        case "ignore":
        default:
          break;
      }
    },
    { isActive: focus }
  );

  return (
    <Text wrap="wrap">
      {placeholder
        ? displayValue.length > 0
          ? renderedValue
          : renderedPlaceholder
        : renderedValue}
    </Text>
  );
};

export default EnhancedTextInput;

export interface UncontrolledEnhancedTextInputProps
  extends Omit<EnhancedTextInputProps, "value" | "onChange"> {
  initialValue?: string;
  onChange?: (value: string) => void;
}

export function UncontrolledEnhancedTextInput({
  initialValue = "",
  onChange,
  ...props
}: UncontrolledEnhancedTextInputProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <EnhancedTextInput
      {...props}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}
