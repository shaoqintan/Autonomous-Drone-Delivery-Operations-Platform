import type { Metadata } from "next";
import { OperationsDashboard } from "./operations-dashboard";

export const metadata: Metadata = {
  title: "Zipline Operations Intelligence",
  description:
    "A policy-grounded live operations dashboard for fleet, orders, preflight checks, and urgent issues.",
};

export default function Home() {
  return <OperationsDashboard />;
}
