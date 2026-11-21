import { useEffect } from "react";
import { Redirect } from "expo-router";

export default function AdminSubscriptionsLegacyRedirect() {
  return <Redirect href="/admin/rights" />;
}
