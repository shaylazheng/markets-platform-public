import { useRef } from 'react';
import { useLineChart } from '../useChart.js';

export function Sparkline({ dates, values, color, className = 'wl-spark' }) {
  const ref = useRef(null);
  useLineChart(ref, { dates, values, variant: 'spark', color });
  return <span className={className}><canvas ref={ref} /></span>;
}
