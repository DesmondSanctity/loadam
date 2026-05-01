import { fromOpenApiFile } from "@loadam/core";
import { describe, expect, it } from "vitest";
import { inferResourceGraph } from "../src/index.js";

const NESTED = new URL("../../../fixtures/specs/nested.openapi.yaml", import.meta.url).pathname;

describe("graph inference — nested paths", () => {
  it("detects two kinds (User, Post)", async () => {
    const ir = await fromOpenApiFile(NESTED);
    inferResourceGraph(ir);
    const names = ir.resources.kinds.map((k) => k.name).sort();
    expect(names).toEqual(["Post", "User"]);
  });

  it("classifies Post operations correctly", async () => {
    const ir = await fromOpenApiFile(NESTED);
    inferResourceGraph(ir);
    const post = ir.resources.kinds.find((k) => k.name === "Post");
    expect(post?.createOps).toContain("createPost");
    expect(post?.readOps).toContain("getPost");
    expect(post?.listOps).toContain("listUserPosts");
  });

  it("infers Post → User parent edge from path nesting", async () => {
    const ir = await fromOpenApiFile(NESTED);
    inferResourceGraph(ir);
    const postToUser = ir.resources.edges.find(
      (e) => e.from === "Post" && e.to === "User" && e.via.param === "userId",
    );
    expect(postToUser).toBeDefined();
    expect(postToUser?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("annotates Post operations with consumes:[User]", async () => {
    const ir = await fromOpenApiFile(NESTED);
    inferResourceGraph(ir);
    const create = ir.operations.find((o) => o.id === "createPost");
    expect(create?.consumes?.some((c) => c.kind === "User")).toBe(true);
  });
});
