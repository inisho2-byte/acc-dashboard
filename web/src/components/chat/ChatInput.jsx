import { useState, useRef, useEffect, useCallback } from "react";

const THEME = {
  primary: "#00d4ff",
  danger: "#ff4444",
  mono: "'Space Mono', monospace",
  textMain: "#e8f4fd",
  textMuted: "rgba(150,180,220,0.5)",
  bg: "rgba(0,5,16,0.8)",
  amber: "#ffaa00",
};

const styles = {
  bar: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "8px 12px",
    background: THEME.bg,
    borderTop: `1px solid ${THEME.primary}33`,
  },
  input: {
    flex: 1,
    background: "transparent",
    border: `1px solid ${THEME.primary}44`,
    borderRadius: 3,
    padding: "6px 10px",
    color: THEME.textMain,
    fontFamily: THEME.mono,
    fontSize: 12,
    lineHeight: "1.4",
    resize: "none",
    outline: "none",
    minHeight: 28,
    maxHeight: 56,
    overflowY: "auto",
  },
  inputLoading: {
    border: `1px solid ${THEME.amber}88`,
  },
  btnBase: {
    fontFamily: THEME.mono,
    fontSize: 12,
    padding: "6px 10px",
    border: "none",
    borderRadius: 3,
    cursor: "pointer",
    minWidth: 32,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    background: THEME.primary,
    color: "#000",
  },
  sendBtnDisabled: {
    background: `${THEME.primary}44`,
    color: THEME.textMuted,
    cursor: "not-allowed",
  },
  cancelBtn: {
    background: THEME.danger,
    color: "#fff",
  },
};

export default function ChatInput({
  onSend,
  onCancel,
  loading = false,
  disabled = false,
  placeholder = "Type a message...",
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = 56; // ~3 rows at 1.4 line-height + padding
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || loading) return;
    onSend(trimmed);
    setValue("");
    // Reset height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, loading, onSend]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Shift+Enter inserts newline naturally in textarea
    },
    [handleSend]
  );

  const canSend = value.trim().length > 0 && !disabled && !loading;

  return (
    <div style={styles.bar}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        style={{
          ...styles.input,
          ...(loading ? styles.inputLoading : {}),
        }}
      />
      {loading ? (
        <button
          style={{ ...styles.btnBase, ...styles.cancelBtn }}
          onClick={onCancel}
          title="Stop generation"
        >
          ■
        </button>
      ) : (
        <button
          style={{
            ...styles.btnBase,
            ...(canSend ? styles.sendBtn : styles.sendBtnDisabled),
          }}
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
        >
          ▶
        </button>
      )}
    </div>
  );
}
