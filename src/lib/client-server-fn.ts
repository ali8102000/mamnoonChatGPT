import { supabase } from "@/integrations/supabase/client";

export type ClientContext = {
  supabase: typeof supabase;
  userId: string;
};

type ClientHandler<T = any, R = unknown> = (args: {
  data: T;
  context: ClientContext;
}) => R | Promise<R>;

type ClientValidator = (data: any) => any;
type ClientCall<R> = (args?: { data?: any }) => Promise<R>;

type ClientBuilder = {
  middleware: (_middleware: unknown[]) => ClientBuilder;
  inputValidator: <V extends ClientValidator>(validator: V) => {
    handler: <R>(handler: ClientHandler<ReturnType<V>, R>) => ClientCall<Awaited<R>>;
  };
  handler: <R>(handler: ClientHandler<any, R>) => ClientCall<Awaited<R>>;
};

async function run<T, R>(
  handler: ClientHandler<T, R>,
  args?: { data?: any },
  validator?: ClientValidator,
): Promise<Awaited<R>> {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) throw new Error("سجّل الدخول أولاً");

  const rawData = args?.data ?? {};
  const data = validator ? validator(rawData) : rawData;
  return await handler({
    data,
    context: { supabase, userId: auth.user.id },
  }) as Awaited<R>;
}

/**
 * Client-side compatibility builder for the former TanStack Server Functions.
 * It preserves the existing { data } call contract while executing against the
 * authenticated Supabase client directly in the browser.
 */
export function createClientFn(_options: { method?: "GET" | "POST" } = {}): ClientBuilder {
  const builder: ClientBuilder = {
    middleware: () => builder,
    inputValidator: (validator) => ({
      handler: (handler) => (args) => run(handler, args, validator),
    }),
    handler: (handler) => (args) => run(handler, args),
  };
  return builder;
}
