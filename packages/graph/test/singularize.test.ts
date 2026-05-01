import { describe, expect, it } from "vitest";
import { singularize, toEntityName } from "../src/singularize.js";

describe("singularize", () => {
  it("handles regular plurals", () => {
    expect(singularize("pets")).toBe("pet");
    expect(singularize("users")).toBe("user");
    expect(singularize("orders")).toBe("order");
  });

  it("handles -ies → -y", () => {
    expect(singularize("categories")).toBe("category");
    expect(singularize("companies")).toBe("company");
  });

  it("handles -es plurals", () => {
    expect(singularize("boxes")).toBe("box");
    expect(singularize("matches")).toBe("match");
    expect(singularize("addresses")).toBe("address");
  });

  it("leaves already-singular words alone", () => {
    expect(singularize("status")).toBe("status");
    expect(singularize("analysis")).toBe("analysis");
    expect(singularize("user")).toBe("user");
  });

  it("handles irregulars", () => {
    expect(singularize("people")).toBe("person");
    expect(singularize("children")).toBe("child");
  });
});

describe("toEntityName", () => {
  it("produces PascalCase singular", () => {
    expect(toEntityName("pets")).toBe("Pet");
    expect(toEntityName("user_groups")).toBe("UserGroup");
    expect(toEntityName("payment-intents")).toBe("PaymentIntent");
  });
});
