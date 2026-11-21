import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/subscriptions")({
  ssr: false,
  component: () => <Navigate to="/admin" />,
});
