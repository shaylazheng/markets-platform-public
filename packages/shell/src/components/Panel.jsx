/* The panel shell every widget sits in: a borderless surface with a tonal
   header. `flush` removes body padding for tables and charts. */
export function Panel({ id, swatch = 'a', title, tools, children, flush = false, compact = false, headExtra }) {
  return (
    <div className={`pnl pnl-sw-${swatch}` + (compact ? ' pnl-compact' : '')} id={id}>
      <div className="pnl-head">
        <span className={`pnl-swatch sw-${swatch}`} />
        {title && <span className="pnl-title">{title}</span>}
        {headExtra}
        {tools && <div className="pnl-tools">{tools}</div>}
      </div>
      <div className={'pnl-body' + (flush ? ' pnl-body-flush' : '')}>{children}</div>
    </div>
  );
}

export const IconBtn = ({ children, small, on, ...rest }) => (
  <button type="button" className={'icon-btn' + (small ? ' sm' : '') + (on ? ' is-on' : '')} {...rest}>
    {children}
  </button>
);
