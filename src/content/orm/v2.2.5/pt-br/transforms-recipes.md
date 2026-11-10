# Receitas de transforms

Cada receita é um `dinoco/transform.rs` completo que você pode copiar. Mantenha só os hooks que usar.

## Adicionar derives e imports

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

A crate que fornece o derive (`validator`, `strum`) é dependência da *sua* aplicação, então adicione-a ao seu `Cargo.toml`. Derives que compartilham o último segmento com um que o Dinoco já adiciona (`Clone`, `Debug`, `Serialize`, `Deserialize`) são ignorados, porque derivar a mesma trait duas vezes não compila.

## Adicionar atributos a campos

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

Os atributos são acrescentados depois dos que o Dinoco escreve. Num campo anulável, o `serde(with = ...)` que você escolher precisa combinar com o tipo `Option<...>`; verifique `field.nullable` quando o módulo citado só trata um formato.

## Adicionar métodos

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

Todos os métodos adicionados com `add_impl_method` compartilham um único bloco `impl` inerente, na ordem em que foram adicionados.

## Implementar uma trait

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

Para uma trait com itens associados, monte o bloco explicitamente:

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

## Todos os arquivos de uma vez

```rust
fn transform_schema(&self, schema: &mut Schema) {
    schema.add_import("use std::fmt::Debug");

    for model in &mut schema.models {
        model.add_attribute("#[serde(rename_all = \"camelCase\")]");
    }
}
```

## Mudar o tipo de um campo

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    if field.name == "metadata" {
        field.ty = RustType::new("crate::Metadata");
    }
}
```

O Dinoco não verifica se o novo tipo funciona com a coluna do banco; para ele é só texto no arquivo gerado.

## Guardar um enum numa coluna de string

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    if model.name == "Grant" && field.name == "permission" {
        field.set_runtime_enum("crate::Permission");
    }
}
```

`crate::Permission` deriva [`DinocoRuntimeEnum`](/pt-br/docs/orm/guide/defaults-enums#enums-em-colunas-de-string), e a coluna continua `String` no schema. Use `set_runtime_enum` em vez de atribuir `field.ty`: ele também marca o field com `#[dinoco(enum)]`, para que um `Option<crate::Permission>` não seja tomado por uma relação, e transforma um `@default("permission:view-users")` de string nessa variante. O enum precisa implementar `Debug`, `Clone` e `Default`, além de `Serialize`/`Deserialize` quando o model os deriva.

## Guardar uma struct numa coluna

`set_runtime_struct` troca um field por uma struct que deriva `DinocoRuntimeStruct`, enquanto a coluna mantém o tipo do schema: um newtype como `Amount(i64)` sobre uma coluna `Integer`, ou uma struct serde sobre uma coluna `Json`.

```rust
fn transform_field(&self, model: &Model, field: &mut Field) {
    match (model.name.as_str(), field.name.as_str()) {
        ("Transaction", "amount" | "charged_fees") => field.set_runtime_struct("crate::Amount"),
        ("Transaction", "metadata") => field.set_runtime_struct("crate::TransactionMetadata"),
        _ => {}
    }
}
```

Use-o em vez de atribuir `field.ty`: ele também marca o field com `#[dinoco(scalar)]`, para que um `Option<crate::Amount>` não seja confundido com uma relação, e transforma um `@default(...)` do schema na struct lida desse valor. Como um enum de runtime, a struct precisa implementar `Debug`, `Clone` e `Default` (os models implementam `Default`), além de `Serialize`/`Deserialize` quando o model os deriva.

### Um newtype sobre uma coluna

Uma tuple struct com um field é guardada como esse field, e lida de volta via `TryFrom` do tipo da coluna — que o `From` fornece, então uma conversão simples basta:

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, DinocoRuntimeStruct)]
pub struct Amount(i64);

impl From<i64> for Amount {
    fn from(cents: i64) -> Self {
        Amount(cents)
    }
}
```

Implemente `TryFrom<i64>` no lugar para recusar valores: uma row cuja coluna a struct recusa falha ao decodificar, com o erro na mensagem.

### Uma struct em JSON

`#[dinoco(json)]` guarda qualquer tipo serde numa coluna `Json`, escrito com `serde_json::to_value` e lido com `serde_json::from_value`:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize, DinocoRuntimeStruct)]
#[dinoco(json)]
pub struct TransactionMetadata {
    pub source: String,
    pub tags: Vec<String>,
}
```

### Qualquer struct sobre uma coluna

`#[dinoco(column = i64)]` liga qualquer outra struct a um tipo de coluna: ela é escrita via `From<&Self> for i64` e lida via `TryFrom<i64>`.

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

### O que o field suporta

A struct é lida e escrita onde o field estiver: inserts, updates (`x.amount.set(Amount(5))`), filtros (`x.amount.gt(Amount(100))`, e o tipo da própria coluna também serve: `x.amount.gt(100)`), `pluck`, chaves de `group_by`, includes e transactions. Sobre um número, `sum` e `avg` funcionam, e sobre qualquer coluna ordenável, `min` e `max`; cada um volta como a struct (`Amount`, `Option<Amount>`). Updates aritméticos (`increment`, ...) e `between` continuam só com os tipos simples.

## Migrar de custom_derives

Troque cada entrada de `custom_derives` por um hook. Uma entrada com `into = "enum"` vira `transform_enum`, e `into = "struct"` vira `transform_model`:

```dinoco
config {
    custom_derives = [
        { into = "enum",   derive = "ZodSchema", import = "use zod_rs::prelude::*;" },
        { into = "struct", derive = "Validate",  import = "use validator::Validate;" }
    ]
}
```

vira, em `dinoco/transform.rs`:

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

e a chave `custom_derives` é apagada do `schema.dinoco`. Diferente do `custom_derives`, um transform pode olhar o model e aplicar um derive só a alguns deles.

## Testar um transform

Os renderizadores são funções comuns, então um transform pode ser testado sem tocar no sistema de arquivos, a partir de qualquer crate que dependa de `dinoco_codegen` e `dinoco_compiler`:

```rust
let schema = dinoco_compiler::compile("model User { id String @id }")?;
let mut generated = dinoco_codegen::build_schema(&schema);
dinoco_codegen::apply_transformer(&mut generated, &MyTransformer);

let user = generated.model("User").unwrap();
let source = dinoco_codegen::render_model_source(user, &generated.imports_for(&user.imports));
assert!(source.contains("pub fn is_active"));
```

## Limites

- O transformer roda como um programa próprio: ele enxerga o schema e a estrutura gerada pelo Dinoco, não os tipos da sua aplicação.
- Não renomeie models, enums nem seus campos: as relações, a lista de módulos gerada e o derive `Entity` continuam se referindo aos nomes originais. Customize por derives, atributos, imports e impls.
- O Dinoco não compila o texto que você gera. Um erro de digitação num corpo ou atributo aparece na próxima vez que você compilar a aplicação, no arquivo gerado.
