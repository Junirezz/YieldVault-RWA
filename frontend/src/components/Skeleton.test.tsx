import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Skeleton, {
  SkeletonBlock,
  SkeletonCircle,
  SkeletonText,
  TableSkeleton,
  DashboardCardSkeleton,
  ChartSkeleton,
  SharePriceSkeleton,
  VaultStatSkeleton,
  TransactionRowSkeleton,
  PortfolioCardSkeleton,
  AnalyticsWidgetSkeleton,
  StrategyCardSkeleton,
} from "./Skeleton";

describe("Skeleton", () => {
  it("renders SkeletonBlock with aria-hidden", () => {
    const { container } = render(<SkeletonBlock width="100px" height="20px" />);
    const el = container.querySelector(".skeleton");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("aria-hidden")).toBe("true");
  });

  it("exports SkeletonBlock as default", () => {
    const { container } = render(<Skeleton width="50px" height="10px" />);
    expect(container.querySelector(".skeleton")).toBeTruthy();
  });

  it("renders SkeletonCircle as a round block", () => {
    const { container } = render(<SkeletonCircle width={24} height={24} />);
    const el = container.querySelector(".skeleton") as HTMLElement;
    expect(el.style.borderRadius).toBe("50%");
  });

  it("renders multi-line SkeletonText", () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.querySelectorAll(".skeleton")).toHaveLength(3);
  });

  it("renders TableSkeleton with expected rows and columns", () => {
    const { container } = render(<TableSkeleton columns={3} rows={2} />);
    expect(container.querySelectorAll("tr.data-table-row")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(6);
  });

  it("renders vault page skeleton variants", () => {
    const variants = [
      <DashboardCardSkeleton key="dash" />,
      <ChartSkeleton key="chart" />,
      <SharePriceSkeleton key="share" />,
      <VaultStatSkeleton key="stat" />,
      <TransactionRowSkeleton key="tx" />,
      <PortfolioCardSkeleton key="port" />,
      <AnalyticsWidgetSkeleton key="analytics" />,
      <StrategyCardSkeleton key="strategy" />,
    ];
    for (const variant of variants) {
      const { container, unmount } = render(variant);
      expect(container.querySelector(".skeleton")).toBeTruthy();
      unmount();
    }
  });
});
