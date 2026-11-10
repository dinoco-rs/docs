# Transform recipes

Each recipe is a complete `dinoco/transform.rs` you can copy. Keep only the hooks you use.

## Add derives and imports

```rust
use dinoco::codegen::*;

pub fn transformer() -> impl DinocoTransformer {
    struct Derives;

    impl DinocoTransformer for Derives {
        fn transform_model(&self, model: &mut Model) {
            model.add_derive("validator::Validate");
            model.add_import("use validator::Validate");
        }

        fn transform_enum(&self, item: &mut Enum) {
            item.add_derive("strum::Display");
            item.add_import("use strum::Display");
        }
    }

    Derives
}
```

The crate providing the derive (`validator`, `strum`) is a dependency of *your* application, so add it to your `Cargo.toml`. Derives that share a last path segment with one Dinoco already adds (`Clone`, `Debug`, `Serialize`, `Deserialize`) are skipped, because deriving the same trait twice does not compile.

## Add attributes to fields

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    if field.name.ends_with("_at") {
        field.add_attribute(r#"#[serde(with = "chrono::serde::ts_seconds")]"#);
    }

    if model.name == "User" && field.name == "password_hash" {
        field.add_attribute("#[serde(skip_serializing)]");
    }
}
```

Attributes are appended after the ones Dinoco writes. For a nullable field the `serde(with = ...)` you choose has to match the `Option<...>` type; check `field.nullable` when the module you name only handles one shape.

## Add methods

```rust
fn transform_model(&self, model: &mut Model) {
    if model.has_derive("Entity") && model.field("deleted_at").is_some() {
        model.add_impl_method(ImplMethod::new(
            "is_active",
            "bool",
            quote! { self.deleted_at.is_none() },
        ));
    }

    model.add_impl_method(ImplMethod {
        name: "table".into(),
        receiver: Receiver::None,
        return_type: "&'static str".into(),
        body: format!("\"{}\"", model.table_name),
        ..ImplMethod::default()
    });
}
```

All methods added with `add_impl_method` share a single inherent `impl` block, in the order you added them.

## Implement a trait

```rust
fn transform_model(&self, model: &mut Model) {
    model.add_import("std::fmt");
    model.add_trait_impl(
        "fmt::Display",
        r#"fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(formatter, "{}", self.id)
}"#,
    );
}
```

For a trait with associated items, build the block explicitly:

```rust
model.add_impl(
    ImplBlock::for_trait("TryFrom<&str>")
        .item("type Error = String;")
        .method(ImplMethod {
            name: "try_from".into(),
            visibility: Visibility::Private,
            receiver: Receiver::None,
            params: vec![("value".into(), "&str".into())],
            return_type: "Result<Self, Self::Error>".into(),
            body: "Err(format!(\"cannot parse {value}\"))".into(),
            ..ImplMethod::default()
        }),
);
```

## Enums

```rust
fn transform_enum(&self, item: &mut Enum) {
    item.add_derive("Hash");

    let arms = item
        .variants
        .iter()
        .map(|variant| format!("Self::{} => \"{}\",", variant.name, variant.value))
        .collect::<String>();
    item.add_impl_method(ImplMethod::new("label", "&'static str", format!("match self {{ {arms} }}")));
}

fn transform_variant(&self, item: &Enum, variant: &mut Variant) {
    if item.name == "Status" && variant.value == "legacy" {
        variant.add_attribute("#[deprecated]");
    }
}
```

## Every file at once

```rust
fn transform_schema(&self, schema: &mut Schema) {
    schema.add_import("use std::fmt::Debug");

    for model in &mut schema.models {
        model.add_attribute("#[serde(rename_all = \"camelCase\")]");
    }
}
```

## Change a field's type

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    if field.name == "metadata" {
        field.ty = RustType::new("crate::Metadata");
    }
}
```

Dinoco does not check that the new type works with the database column; it is only text in the generated file.

## Store an enum in a string column

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    if model.name == "Grant" && field.name == "permission" {
        field.set_runtime_enum("crate::Permission");
    }
}
```

`crate::Permission` derives [`DinocoRuntimeEnum`](/en-us/docs/orm/guide/defaults-enums#enums-in-string-columns), and the column stays `String` in the schema. Use `set_runtime_enum` rather than assigning `field.ty`: it also marks the field `#[dinoco(enum)]`, so an `Option<crate::Permission>` is not taken for a relation, and turns a string `@default("permission:view-users")` into that variant. The enum must implement `Debug`, `Clone`, and `Default`, plus `Serialize`/`Deserialize` when the model derives them.

## Store a struct in a column

`set_runtime_struct` switches a field to a struct that derives `DinocoRuntimeStruct`, while the column keeps its schema type: a newtype such as `Amount(i64)` over an `Integer` column, or a serde struct over a `Json` column.

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    match (model.name.as_str(), field.name.as_str()) {
        ("Transaction", "amount" | "charged_fees") => field.set_runtime_struct("crate::Amount"),
        ("Transaction", "metadata") => field.set_runtime_struct("crate::TransactionMetadata"),
        _ => {}
    }
}
```

Use it rather than assigning `field.ty`: it also marks the field `#[dinoco(scalar)]`, so an `Option<crate::Amount>` is not taken for a relation, and turns a schema `@default(...)` into the struct read from that value. Like a runtime enum, the struct must implement `Debug`, `Clone`, and `Default` (models implement `Default`), plus `Serialize`/`Deserialize` when the model derives them.

### A newtype over a column

A tuple struct with one field is stored as that field, and read back through `TryFrom` the column's type — which `From` provides, so a plain conversion is enough:

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, DinocoRuntimeStruct)]
pub struct Amount(i64);

impl From<i64> for Amount {
    fn from(cents: i64) -> Self {
        Amount(cents)
    }
}
```

Implement `TryFrom<i64>` instead to reject values: a row whose column the struct refuses fails to decode, with the error in the message.

### A JSON struct

`#[dinoco(json)]` stores any serde type in a `Json` column, written with `serde_json::to_value` and read with `serde_json::from_value`:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, DinocoRuntimeStruct)]
#[dinoco(json)]
pub struct TransactionMetadata {
    pub source: String,
    pub tags: Vec<String>,
}
```

### Any struct over a column

`#[dinoco(column = i64)]` maps any other struct to a column type: it is written through `From<&Self> for i64` and read through `TryFrom<i64>`.

```rust
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, DinocoRuntimeStruct)]
#[dinoco(column = i64)]
pub struct Money {
    cents: u32,
}

impl From<&Money> for i64 {
    fn from(money: &Money) -> Self {
        i64::from(money.cents)
    }
}

impl TryFrom<i64> for Money {
    type Error = std::num::TryFromIntError;

    fn try_from(cents: i64) -> Result<Self, Self::Error> {
        Ok(Money { cents: u32::try_from(cents)? })
    }
}
```

### What the field supports

The struct is read and written wherever the field is: inserts, updates (`x.amount.set(Amount(5))`), filters (`x.amount.gt(Amount(100))`, and the column's own type works too: `x.amount.gt(100)`), `pluck`, `group_by` keys, includes, and transactions. Over a number, `sum` and `avg` work, and over any ordered column `min` and `max`; each is read back as the struct (`Amount`, `Option<Amount>`). Arithmetic updates (`increment`, ...) and `between` stay with the plain types.

## Migrate from custom_derives

Replace each `custom_derives` entry with a hook. An entry with `into = "enum"` becomes `transform_enum`, and `into = "struct"` becomes `transform_model`:

```dinoco
config {
    custom_derives = [
        { into = "enum",   derive = "ZodSchema", import = "use zod_rs::prelude::*;" },
        { into = "struct", derive = "Validate",  import = "use validator::Validate;" }
    ]
}
```

becomes, in `dinoco/transform.rs`:

```rust
use dinoco::codegen::*;

struct Legacy;

impl DinocoTransformer for Legacy {
    fn transform_enum(&self, item: &mut Enum) {
        item.add_derive("ZodSchema");
        item.add_import("use zod_rs::prelude::*;");
    }

    fn transform_model(&self, model: &mut Model) {
        model.add_derive("Validate");
        model.add_import("use validator::Validate;");
    }
}

pub fn transformer() -> impl DinocoTransformer {
    Legacy
}
```

and the `custom_derives` key is deleted from `schema.dinoco`. Unlike `custom_derives`, a transform can look at the model and apply a derive to only some of them.

## Test a transform

The renderers are ordinary functions, so a transform can be tested without touching the filesystem, from any crate that depends on `dinoco_codegen` and `dinoco_compiler`:

```rust
let schema = dinoco_compiler::compile("model User { id String @id }")?;
let mut generated = dinoco_codegen::build_schema(&schema);
dinoco_codegen::apply_transformer(&mut generated, &MyTransformer);

let user = generated.model("User").unwrap();
let source = dinoco_codegen::render_model_source(user, &generated.imports_for(&user.imports));
assert!(source.contains("pub fn is_active"));
```

## Limits

- The transformer runs as its own program: it sees the schema and Dinoco's generated structure, not your application's types.
- Do not rename models, enums, or their fields: relations, the generated module list, and the `Entity` derive still refer to the original names. Customize through derives, attributes, imports, and impls.
- Dinoco does not compile the text you generate. A typo in a body or an attribute surfaces the next time you build your application, in the generated file.
