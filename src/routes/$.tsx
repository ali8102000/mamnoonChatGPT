import { createFileRoute, Navigate, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/$")({
  ssr: false,
  beforeLoad: ({ params }) => {
    if (params._splat !== "index") throw notFound();
  },
  head: () => ({
    meta: [
      { title: "بدء كفو" },
      { name: "description", content: "الانتقال إلى بداية تطبيق كفو للنقل والخدمات." },
      { property: "og:title", content: "بدء كفو" },
      { property: "og:description", content: "الانتقال إلى بداية تطبيق كفو للنقل والخدمات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Navigate to="/" replace />,
});
