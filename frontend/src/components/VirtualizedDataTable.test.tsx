import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  VirtualizedDataTable,
  shouldVirtualizeTransactionList,
  VIRTUALIZATION_THRESHOLD,
} from "./VirtualizedDataTable";
import type { DataTableColumn } from "./DataTable";

vi.mock("../i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// lucide-react icons are irrelevant to these tests — stub them out so
// the test environment doesn't need to resolve the real package.
vi.mock("lucide-react", () => ({
  ChevronLeft: () => null,
  ChevronRight: () => null,
  MoreHorizontal: () => null,
}));

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: (row) => row.name },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    name: `Row ${i + 1}`,
  }));
}

const basePagination = {
  page: 1,
  pageSize: 10,
  totalItems: 30,
  totalPages: 3,
};

// ─── helper ─────────────────────────────────────────────────────────────────
function stubLayout() {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 200,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 400,
  });
}

// ─── shouldVirtualizeTransactionList ────────────────────────────────────────
describe("shouldVirtualizeTransactionList", () => {
  it("returns false below the threshold", () => {
    expect(shouldVirtualizeTransactionList(VIRTUALIZATION_THRESHOLD - 1)).toBe(
      false,
    );
  });

  it("returns true at or above the threshold", () => {
    expect(shouldVirtualizeTransactionList(VIRTUALIZATION_THRESHOLD)).toBe(true);
    expect(shouldVirtualizeTransactionList(200)).toBe(true);
  });
});

// ─── VirtualizedDataTable – core rendering ──────────────────────────────────
describe("VirtualizedDataTable", () => {
  beforeEach(stubLayout);

  it("renders only a subset of rows in the scroll container", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(120)}
        rowKey={(row) => row.id}
        caption="Test table"
        emptyMessage="No rows"
        maxHeight={200}
      />,
    );

    expect(screen.getByTestId("virtualized-table-body")).toBeInTheDocument();
    const renderedRows = screen.getAllByRole("row").filter((row) =>
      row.classList.contains("data-table-row"),
    );
    expect(renderedRows.length).toBeLessThan(120);
    expect(screen.getByText("Row 1")).toBeInTheDocument();
  });

  it("shows empty message when there are no rows", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        caption="Test table"
        emptyMessage="Nothing here"
      />,
    );

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});

// ─── a11y: single-table semantics ───────────────────────────────────────────
describe("VirtualizedDataTable – a11y / single-table structure", () => {
  beforeEach(stubLayout);

  it("renders exactly one table element", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(5)}
        rowKey={(row) => row.id}
        caption="Accessible table"
        emptyMessage="No rows"
      />,
    );

    expect(screen.getAllByRole("table")).toHaveLength(1);
  });

  it("thead and tbody live inside the same table", () => {
    const { container } = render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(5)}
        rowKey={(row) => row.id}
        caption="Accessible table"
        emptyMessage="No rows"
      />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    // Both structural sections must be direct descendants of the same table.
    expect(table!.querySelector("thead")).not.toBeNull();
    expect(table!.querySelector("tbody")).not.toBeNull();
  });

  it("column headers use scope='col'", () => {
    const { container } = render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(3)}
        rowKey={(row) => row.id}
        caption="Scoped headers"
        emptyMessage="No rows"
      />,
    );

    const ths = container.querySelectorAll("thead th");
    expect(ths.length).toBeGreaterThan(0);
    ths.forEach((th) => {
      expect(th.getAttribute("scope")).toBe("col");
    });
  });

  it("table has a visible caption for screen readers", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(3)}
        rowKey={(row) => row.id}
        caption="My accessible caption"
        emptyMessage="No rows"
      />,
    );

    // caption is visually hidden (.sr-only) but present in the DOM.
    expect(screen.getByText("My accessible caption")).toBeInTheDocument();
  });

  it("thead has position:sticky so it does not leave the table while scrolling", () => {
    const { container } = render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(5)}
        rowKey={(row) => row.id}
        caption="Sticky header"
        emptyMessage="No rows"
        maxHeight={100}
      />,
    );

    const thead = container.querySelector("thead") as HTMLElement;
    expect(thead).not.toBeNull();
    expect(thead.style.position).toBe("sticky");
    expect(thead.style.top).toBe("0px");
  });

  it("marks the scroll container with data-testid='virtualized-table-body'", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(5)}
        rowKey={(row) => row.id}
        caption="Test"
        emptyMessage="No rows"
      />,
    );

    const container = screen.getByTestId("virtualized-table-body");
    // The scroll container must contain the table, not be a child of it.
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("empty state row renders inside the single table", () => {
    const { container } = render(
      <VirtualizedDataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        caption="Empty table"
        emptyMessage="Empty state text"
      />,
    );

    const table = container.querySelector("table")!;
    expect(within(table).getByText("Empty state text")).toBeInTheDocument();
  });
});

// ─── pagination ─────────────────────────────────────────────────────────────
describe("VirtualizedDataTable – pagination", () => {
  beforeEach(stubLayout);

  it("renders the <Pagination> component when pagination prop is provided", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={basePagination}
        onPageChange={vi.fn()}
      />,
    );

    // Pagination renders an aria-label="Pagination" region.
    expect(screen.getByLabelText("Pagination")).toBeInTheDocument();
  });

  it("does NOT render pagination when no pagination prop is passed", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="No pagination"
        emptyMessage="No rows"
      />,
    );

    expect(screen.queryByLabelText("Pagination")).toBeNull();
  });

  it("renders exactly one pagination control (no duplicate prev/next block)", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={basePagination}
        onPageChange={vi.fn()}
      />,
    );

    // There must be exactly one "Previous" and one "Next" button in the DOM.
    expect(screen.getAllByRole("button", { name: /previous/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /next/i })).toHaveLength(1);
  });

  it("calls onPageChange when the Next button is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={basePagination}
        onPageChange={onPageChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange when the Previous button is clicked (not on page 1)", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={{ ...basePagination, page: 2 }}
        onPageChange={onPageChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("Previous button is disabled on the first page", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={{ ...basePagination, page: 1 }}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
  });

  it("Next button is disabled on the last page", () => {
    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={{ ...basePagination, page: 3, totalPages: 3 }}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("calls onPageSizeChange when page size selector is changed", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();

    render(
      <VirtualizedDataTable
        columns={columns}
        rows={makeRows(10)}
        rowKey={(row) => row.id}
        caption="Paginated"
        emptyMessage="No rows"
        pagination={basePagination}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", { name: /rows per page/i }),
      "20",
    );
    expect(onPageSizeChange).toHaveBeenCalledWith(20);
  });
});
