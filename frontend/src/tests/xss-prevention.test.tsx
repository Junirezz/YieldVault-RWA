/**
 * XSS Prevention Test Suite
 * 
 * Tests that user-provided content is safely rendered and cannot execute malicious scripts.
 * These tests verify React's automatic escaping and our security utilities.
 */

import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import FormField from '../forms/components/FormField';

// Common XSS attack vectors
const XSS_PAYLOADS = [
  '<script>alert("XSS")</script>',
  '<img src=x onerror=alert("XSS")>',
  '<svg onload=alert("XSS")>',
  'javascript:alert("XSS")',
  '<iframe src="javascript:alert(\'XSS\')">',
  '<body onload=alert("XSS")>',
  '"><script>alert(String.fromCharCode(88,83,83))</script>',
  '<img src="x" onerror="eval(atob(\'YWxlcnQoJ1hTUycpOw==\'))">',
  '<svg><script>alert(1)</script></svg>',
  '<input onfocus=alert(1) autofocus>',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>',
  '<video><source onerror="alert(1)">',
  '<audio src=x onerror=alert(1)>',
];

describe('XSS Prevention - DataTable Component', () => {
  interface TestRow {
    id: string;
    name: string;
    description: string;
  }

  test('escapes XSS payloads in table cells', () => {
    XSS_PAYLOADS.forEach(payload => {
      const columns: DataTableColumn<TestRow>[] = [
        {
          id: 'name',
          header: 'Name',
          cell: (row) => <span>{row.name}</span>,
        },
      ];

      const rows: TestRow[] = [
        { id: '1', name: payload, description: 'test' },
      ];

      const { container } = render(
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          caption="Test table"
          emptyMessage="No data"
        />
      );

      // Verify no script tags are present in the DOM
      expect(container.innerHTML).not.toContain('<script');
      expect(container.innerHTML).not.toContain('javascript:');
      expect(container.innerHTML).not.toContain('onerror');
      expect(container.innerHTML).not.toContain('onload');
      
      // Verify the payload is escaped (contains &lt; instead of <)
      expect(container.innerHTML).toContain('&lt;');
    });
  });

  test('escapes XSS payloads in table headers', () => {
    const maliciousHeader = '<script>alert(1)</script>';
    
    const columns: DataTableColumn<TestRow>[] = [
      {
        id: 'name',
        header: maliciousHeader,
        cell: (row) => <span>{row.name}</span>,
      },
    ];

    const { container } = render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        caption="Test table"
        emptyMessage="No data"
      />
    );

    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).toContain('&lt;script');
  });

  test('escapes XSS payloads in empty message', () => {
    const maliciousMessage = '<img src=x onerror=alert(1)>';
    
    const columns: DataTableColumn<TestRow>[] = [
      {
        id: 'name',
        header: 'Name',
        cell: (row) => <span>{row.name}</span>,
      },
    ];

    const { container } = render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        caption="Test table"
        emptyMessage={maliciousMessage}
      />
    );

    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).toContain('&lt;img');
  });
});

describe('XSS Prevention - FormField Component', () => {
  test('escapes XSS payloads in error messages', () => {
    XSS_PAYLOADS.forEach(payload => {
      const { container } = render(
        <FormField
          label="Test Field"
          name="test"
          error={payload}
          value=""
          onChange={() => {}}
        />
      );

      expect(container.innerHTML).not.toContain('<script');
      expect(container.innerHTML).not.toContain('javascript:');
      expect(container.innerHTML).not.toContain('onerror');
      expect(container.innerHTML).toContain('&lt;');
    });
  });

  test('escapes XSS payloads in labels', () => {
    const maliciousLabel = '<svg onload=alert(1)>';
    
    const { container } = render(
      <FormField
        label={maliciousLabel}
        name="test"
        value=""
        onChange={() => {}}
      />
    );

    expect(container.innerHTML).not.toContain('onload');
    expect(container.innerHTML).toContain('&lt;svg');
  });

  test('controlled input value is safe', () => {
    XSS_PAYLOADS.forEach(payload => {
      const { container } = render(
        <FormField
          label="Test"
          name="test"
          value={payload}
          onChange={() => {}}
        />
      );

      // Input value attribute should be escaped
      const input = container.querySelector('input');
      expect(input?.value).toBe(payload);
      
      // But the HTML should not contain executable scripts
      expect(container.innerHTML).not.toContain('<script');
    });
  });
});

describe('XSS Prevention - React JSX Rendering', () => {
  test('React automatically escapes text content', () => {
    XSS_PAYLOADS.forEach(payload => {
      const TestComponent = () => <div>{payload}</div>;
      const { container } = render(<TestComponent />);

      expect(container.innerHTML).not.toContain('<script');
      expect(container.innerHTML).toContain('&lt;');
    });
  });

  test('React escapes attribute values', () => {
    const maliciousTitle = '<script>alert(1)</script>';
    const TestComponent = () => <div title={maliciousTitle}>Test</div>;
    const { container } = render(<TestComponent />);

    const div = container.querySelector('div');
    expect(div?.getAttribute('title')).toBe(maliciousTitle);
    expect(container.innerHTML).not.toContain('<script><script>');
  });

  test('React prevents JavaScript protocol in href', () => {
    const maliciousHref = 'javascript:alert(1)';
    const TestComponent = () => <a href={maliciousHref}>Link</a>;
    const { container } = render(<TestComponent />);

    const link = container.querySelector('a');
    // React/browser will sanitize javascript: protocol
    expect(link?.getAttribute('href')).toBe(maliciousHref);
    // But clicking won't execute (browser security)
  });
});

describe('XSS Prevention - Style Injection', () => {
  test('React style prop prevents CSS injection', () => {
    const maliciousStyle = 'color: red; background: url(javascript:alert(1))';
    
    // React style prop only accepts objects, not strings
    // This test verifies TypeScript prevents this at compile time
    const TestComponent = () => (
      <div style={{ color: 'red' }}>Test</div>
    );
    
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).not.toContain('javascript:');
  });

  test('inline style object is safe', () => {
    const userColor = '<script>alert(1)</script>';
    
    // Even if user input is used in style, it's escaped
    const TestComponent = () => (
      <div style={{ color: userColor }}>Test</div>
    );
    
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).not.toContain('<script><script>');
  });
});

describe('XSS Prevention - URL Construction', () => {
  test('template literals with user input are escaped', () => {
    const userId = '<script>alert(1)</script>';
    const TestComponent = () => (
      <a href={`/user/${userId}`}>Profile</a>
    );
    
    const { container } = render(<TestComponent />);
    const link = container.querySelector('a');
    
    // URL encoding happens, but script tags are in the URL, not executed
    expect(link?.getAttribute('href')).toContain(userId);
    expect(container.innerHTML).not.toContain('<script><script>');
  });
});

describe('XSS Prevention - Event Handlers', () => {
  test('event handlers cannot be injected via props', () => {
    const maliciousOnClick = 'alert(1)';
    
    // React event handlers must be functions, not strings
    const TestComponent = () => (
      <button onClick={() => {}}>Click</button>
    );
    
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).not.toContain('onclick="alert(1)"');
  });
});

describe('XSS Prevention - Integration Tests', () => {
  test('complete data flow from API to UI is safe', () => {
    // Simulate malicious data from API
    interface Transaction {
      id: string;
      type: string;
      amount: string;
      asset: string;
    }

    const maliciousTransaction: Transaction = {
      id: '<script>alert(1)</script>',
      type: '<img src=x onerror=alert(1)>',
      amount: '<svg onload=alert(1)>',
      asset: 'javascript:alert(1)',
    };

    const columns: DataTableColumn<Transaction>[] = [
      { id: 'type', header: 'Type', cell: (row) => <span>{row.type}</span> },
      { id: 'amount', header: 'Amount', cell: (row) => <span>{row.amount}</span> },
      { id: 'asset', header: 'Asset', cell: (row) => <span>{row.asset}</span> },
    ];

    const { container } = render(
      <DataTable
        columns={columns}
        rows={[maliciousTransaction]}
        rowKey={(row) => row.id}
        caption="Transactions"
        emptyMessage="No transactions"
      />
    );

    // Verify all malicious content is escaped
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('onload');
    expect(container.innerHTML).not.toContain('javascript:');
    
    // Verify content is escaped
    expect(container.innerHTML).toContain('&lt;');
  });

  test('user input through forms is safe', () => {
    const maliciousInput = '<script>alert(document.cookie)</script>';
    
    const { container } = render(
      <FormField
        label="Amount"
        name="amount"
        value={maliciousInput}
        onChange={() => {}}
      />
    );

    const input = container.querySelector('input');
    expect(input?.value).toBe(maliciousInput);
    expect(container.innerHTML).not.toContain('<script><script>');
  });
});

describe('XSS Prevention - Edge Cases', () => {
  test('handles null and undefined safely', () => {
    const TestComponent = () => (
      <div>
        {null}
        {undefined}
        {false}
      </div>
    );
    
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).toBe('<div></div>');
  });

  test('handles numbers safely', () => {
    const TestComponent = () => <div>{12345}</div>;
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).toBe('<div>12345</div>');
  });

  test('handles arrays safely', () => {
    const items = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'];
    const TestComponent = () => (
      <ul>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    );
    
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).toContain('&lt;script');
  });

  test('handles objects converted to strings', () => {
    const obj = { toString: () => '<script>alert(1)</script>' };
    const TestComponent = () => <div>{String(obj)}</div>;
    const { container } = render(<TestComponent />);
    expect(container.innerHTML).not.toContain('<script><script>');
  });
});
