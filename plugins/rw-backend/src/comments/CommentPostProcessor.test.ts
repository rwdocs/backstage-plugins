import { CommentPostProcessor } from "./CommentPostProcessor";
import { CommentRow } from "./types";

const row = {} as CommentRow;

const flush = () => new Promise((r) => setImmediate(r));

const makeLogger = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
});

const makeProcessor = (name: string, impl?: () => Promise<void>) => ({
  getName: () => name,
  process: jest.fn().mockImplementation(impl ?? (() => Promise.resolve())),
});

describe("CommentPostProcessor", () => {
  it("resolves once and calls every processor with the activity", async () => {
    const activity = { action: "created" as const } as any;
    const resolver = { resolve: jest.fn().mockResolvedValue(activity) } as any;
    const a = makeProcessor("a");
    const b = makeProcessor("b");
    const logger = makeLogger();
    const cpp = new CommentPostProcessor({ resolver, processors: [a, b], logger: logger as any });

    cpp.postProcess("created", row, "user:default/jane");
    await flush();

    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(a.process).toHaveBeenCalledWith(activity);
    expect(b.process).toHaveBeenCalledWith(activity);
  });

  it("skips DB work when there are zero processors", async () => {
    const resolver = { resolve: jest.fn() } as any;
    const logger = makeLogger();
    const cpp = new CommentPostProcessor({ resolver, processors: [], logger: logger as any });

    cpp.postProcess("created", row, "user:default/jane");
    await flush();

    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it("isolates a throwing processor and still calls the rest", async () => {
    const activity = { action: "created" as const } as any;
    const resolver = { resolve: jest.fn().mockResolvedValue(activity) } as any;
    const boom = makeProcessor("boom", () => Promise.reject(new Error("boom!")));
    const ok = makeProcessor("ok");
    const logger = makeLogger();
    const cpp = new CommentPostProcessor({
      resolver,
      processors: [boom, ok],
      logger: logger as any,
    });

    cpp.postProcess("created", row, "user:default/jane");
    await flush();

    expect(boom.process).toHaveBeenCalledWith(activity);
    expect(ok.process).toHaveBeenCalledWith(activity);
    expect(logger.error).toHaveBeenCalled();
  });

  it("suppresses processor calls when the resolver returns undefined", async () => {
    const resolver = { resolve: jest.fn().mockResolvedValue(undefined) } as any;
    const p = makeProcessor("p");
    const logger = makeLogger();
    const cpp = new CommentPostProcessor({ resolver, processors: [p], logger: logger as any });

    cpp.postProcess("created", row, "user:default/jane");
    await flush();

    expect(p.process).not.toHaveBeenCalled();
  });
});
