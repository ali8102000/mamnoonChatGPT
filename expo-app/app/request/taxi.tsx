import { Redirect } from "expo-router";

/** Dedicated taxi entry point, separate from the technician service picker. */
export default function TaxiRequestRoute() {
  return <Redirect href={{ pathname: "/request/new", params: { type: "taxi" } }} />;
}
