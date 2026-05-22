export default function Sparkline({ data = [], color = "#00d4ff", width = 120, height = 28, fillOpacity = 0.12 }) {
  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const min = 0;
  const stepX = width / (data.length - 1 || 1);

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / (max - min)) * (height - 2) - 1;
    return [x, y];
  });

  const linePoints = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPoints = `${linePoints} ${width.toFixed(1)},${height} 0,${height}`;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polygon points={areaPoints} fill={color} opacity={fillOpacity} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={linePoints}
        opacity="0.85"
      />
    </svg>
  );
}
