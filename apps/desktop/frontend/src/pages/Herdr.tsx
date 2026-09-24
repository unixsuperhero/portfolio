import { useSearchParams } from "react-router";
import { createHerdrClient } from "@portfolio/herdr";
import { HerdrPage } from "@portfolio/ui/herdr";
import "@portfolio/ui/herdr.css";
import { api } from "../api.ts";

const client = createHerdrClient((path, init) => api.request(path, init));

export default function Herdr() {
  const [params, setParams] = useSearchParams();
  return <HerdrPage client={client} params={params} onParamsChange={next => setParams(next, { replace: true })} />;
}
