import React, { useMemo } from "react";
import { FONTS } from "../styles/theme.js";

const BASE_STYLES = {
 display: "flex",
 flexDirection: "column",
 overflow: "hidden",
};

function ContentCard({ title, titleRight, children, style }) {
 const mergedStyle = useMemo(() => style ? { ...BASE_STYLES, ...style } : BASE_STYLES, [style]);
 return (
 <div
 className="panel"
 style={mergedStyle}
 >
 {/* Specular highlight — light refraction on curved glass */}
 <div className="panel-specular" />

 {(title || titleRight) && (
 <div
 style={{
 display: "flex",
 alignItems: "center",
 justifyContent: "space-between",
 padding: "12px 14px 10px",
 borderBottom: "1px solid rgba(0,212,255,0.06)",
 flexShrink: 0,
 }}
 >
 {title && (
 <span
 style={{
 fontFamily: FONTS.mono,
 fontSize: 9,
 color: "rgba(0,212,255,0.5)",
 letterSpacing: "0.16em",
 }}
 >
 {title}
 </span>
 )}
 {titleRight && (
 <div>{titleRight}</div>
 )}
 </div>
 )}
 <div className="panel-scroll">{children}</div>
 </div>
 );
}

export default React.memo(ContentCard);
