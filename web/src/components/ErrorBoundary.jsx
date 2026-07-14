import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            fontFamily: "'Space Mono', monospace",
            fontSize: 11,
            color: "rgba(255,68,68,0.7)",
          }}
        >
          <div style={{ marginBottom: 8 }}>PANEL LOAD FAILED</div>
          <div style={{ fontSize: 9, color: "rgba(150,180,220,0.4)", marginBottom: 12 }}>
            {this.state.error?.message || "Unknown error"}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 9,
              color: "#00d4ff",
              background: "rgba(0,212,255,0.08)",
              border: "1px solid rgba(0,212,255,0.2)",
              borderRadius: 3,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            RETRY
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
