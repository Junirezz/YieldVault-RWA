import React from "react";
import "./Table.css";

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: React.ReactNode;
  containerClassName?: string;
}

export const Table: React.FC<TableProps> = ({ children, containerClassName = "", className = "", ...props }) => (
  <div className={`table-container ${containerClassName}`}>
    <table className={`ui-table ${className}`} {...props}>
      {children}
    </table>
  </div>
);

export const Thead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ children, ...props }) => (
  <thead className="ui-thead" {...props}>{children}</thead>
);

export const Tbody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ children, ...props }) => (
  <tbody className="ui-tbody" {...props}>{children}</tbody>
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({ children, ...props }) => (
  <tr className="ui-tr" {...props}>{children}</tr>
);

export const Th: React.FC<React.ThHTMLAttributes<HTMLTableHeaderCellElement>> = ({ children, align = "left", ...props }) => (
  <th className={`ui-th align-${align}`} {...props}>{children}</th>
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableDataCellElement>> = ({ children, align = "left", ...props }) => (
  <td className={`ui-td align-${align}`} {...props}>{children}</td>
);
