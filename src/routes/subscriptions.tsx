import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/subscriptions")({
  ssr: false,
  component: () => <Navigate to="/home" />,
});
