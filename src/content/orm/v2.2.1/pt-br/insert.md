# Insert

O Dinoco usa a própria entity gerada como entrada de insert — não existe uma derive `#[insertable]` separada, nenhuma "create struct" paralela, e nenhuma chamada `.with_relation(...)` para aprender. Defaults, IDs gerados e metadados de relação já vêm embutidos na entity que você já tem.

## Crie uma entity

Use o construtor `new()` gerado, depois ajuste qualquer field público que precisar antes de inserir:

```rust
let mut user = User::new(
    "ana@example.com".to_string(),
    "Ana".to_string(),
);

user.bio = Some("Rust developer".to_string());
```

`new()` só pede valores escalares obrigatórios que não têm default nem gerador — veja [Models e fields](/pt-br/docs/orm/guide/models#a-funcao-new-gerada) para exatamente como essa lista de parâmetros é escolhida. Isso mantém a construção curta sem nunca esconder quais valores são de fato responsabilidade de quem chama.

## Insira uma entity

```rust
dinoco::insert_into::<User>()
    .values(&user)
    .execute(&client)
    .await?;
```

Passar `&user` empresta o valor — o insert não descarta nem move o seu valor, então você pode continuar usando `user` depois. Um valor owned também funciona, se você não precisar dele de novo.

## Insira várias entities

```rust
let users = vec![
    User::new("ana@example.com".to_string(), "Ana".to_string()),
    User::new("leo@example.com".to_string(), "Leo".to_string()),
];

dinoco::insert_many::<User>()
    .values(&users)
    .execute(&client)
    .await?;
```

Por baixo dos panos, isso agrupa cada row na instrução de insert multi-row nativa do adapter ativo — é um batch de verdade, não um loop disparando um `insert_into` por item.

## Insira relações

Preencha entities aninhadas diretamente no field de relação gerado. O mesmo padrão funciona para uma relação `Vec` (muitos) e para a relação `Option` (um):

```rust
let mut user = User::new(
    "ana@example.com".to_string(),
    "Ana".to_string(),
);
user.tokens = vec![UserToken::new(), UserToken::new()];
user.profile = Some(Box::new(Profile::new()));

dinoco::insert_into::<User>()
    .values(&user)
    .execute(&client)
    .await?;
```

O Dinoco insere dados aninhados de one-to-many, many-to-one e one-to-one usando os próprios metadados da relação, e propaga a chave gerada que o lado filho precisa — não tem nada extra para configurar além de preencher o field.

### Conecte many-to-many durante o insert

Numa relação many-to-many implícita, cada endpoint carrega um field virtual `Option<Id>` apontando para o model oposto. Preencha-o antes de chamar `insert_into`, e o endpoint é inserido *e* seu vínculo na pivô é criado, na mesma execução do builder:

```rust
let mut tag = Tag::new("documentation".to_string());
tag.task_id = Some(task.id.clone());

dinoco::insert_into::<Tag>()
    .values(&tag)
    .execute(&client)
    .await?;
```

A mesma regra se aplica de forma independente a cada item de um lote `insert_many`:

```rust
let mut tags = vec![
    Tag::new("rust".to_string()),
    Tag::new("database".to_string()),
];

for tag in &mut tags {
    tag.task_id = Some(task.id.clone());
}

dinoco::insert_many::<Tag>()
    .values(&tags)
    .execute(&client)
    .await?;
```

O Dinoco exclui `task_id` das colunas SQL de verdade de `tag` completamente. Depois de cada `Tag` ser inserida, ele usa esse valor virtual para inserir `(task.id, tag.id)` na tabela pivô separadamente. Deixar como `None` insere o endpoint sem vínculo nenhum — você sempre pode conectar depois. A alternativa, quando os dois endpoints já existem, é não preencher o field virtual em nenhum dos dois e chamar `connect` a partir da API de update.

> [!NOTE]
> O ID virtual é write-only, ponto final — ele volta `None` em toda leitura e todo insert com returning, incluindo `.returning::<S>()`. Não escreva código que espera inspecioná-lo depois para checar se um vínculo existe; consulte a relação em si em vez disso.

Os mesmos payloads funcionam dentro de um contexto de transaction também, fazendo o insert do endpoint e seu vínculo na pivô receberem commit ou rollback como uma única unidade:

```rust
dinoco::transaction(&client, |tx| async move {
    dinoco::insert_into::<Tag>().value(&tag).execute(tx).await?;
    dinoco::insert_many::<Tag>().values(&tags).execute(tx).await?;
    Ok(())
})
.await?;
```

Veja [Many-to-many implícito](/pt-br/docs/orm/guide/relations#many-to-many-implicito) para o quadro completo: fields gerados, comportamento da pivô, carregamento nos dois sentidos, counts, `connect`/`disconnect` e notas de migration.

## Identificadores gerados

Valores UUID e Snowflake são gerados pelo próprio Dinoco, do lado do client, antes mesmo das linhas de relação dependentes serem montadas — o que é exatamente o que torna possível inserir um pai e seus filhos aninhados numa única chamada, já que as linhas filhas podem referenciar a chave do pai antes dele sequer tocar no banco. Chaves de autoincremento funcionam ao contrário: elas são recuperadas *do* banco depois do insert, já que é o banco quem as gera.

## Retorne uma projeção

Sem `.returning(...)`, o resultado de sucesso de um insert é só `()` — não tem nada para devolver se você não pediu nada. Adicione um tipo de entity ou uma projeção `EntityExtend` quando quem chama de fato precisa dos dados inseridos:

```rust
let inserted = dinoco::insert_into::<User>()
    .values(&user)
    .returning::<UserSummary>()
    .execute(&client)
    .await?;

let inserted_many = dinoco::insert_many::<User>()
    .values(&users)
    .returning::<User>()
    .execute(&client)
    .await?;
```

A primeira chamada retorna um `UserSummary`; a segunda retorna `Vec<User>`. Só peça dados de returning quando você for realmente usá-los — um insert aninhado pode precisar de uma releitura extra internamente para montar a projeção exata que você pediu.

## Pluck em uma única coluna

`.pluck(...)` é uma alternativa mais leve a `.returning::<S>()` quando só uma coluna é necessária:

```rust
let id = dinoco::insert_into::<User>()
    .values(&user)
    .pluck(|x| x.id)
    .execute(&client)
    .await?; // i64

let ids = dinoco::insert_many::<User>()
    .values(&users)
    .pluck(|x| x.id)
    .execute(&client)
    .await?; // Vec<i64>
```

`insert_into` retorna o valor extraído diretamente; `insert_many` retorna um por row inserida, no mesmo formato que `.returning::<S>()` retornaria. Ele substitui `.returning::<S>()` em vez de se combinar com ele.

## Transforme as rows retornadas

Encadeie `.transform(...)` depois de `.returning::<S>()` para mapear a(s) row(s) inserida(s) do lado do Rust, depois que o insert já rodou:

```rust
let name = dinoco::insert_into::<User>()
    .values(&user)
    .returning::<User>()
    .transform(|user| user.name)
    .execute(&client)
    .await?; // String

let names = dinoco::insert_many::<User>()
    .values(&users)
    .returning::<User>()
    .transform(|user| user.name)
    .execute(&client)
    .await?; // Vec<String>
```

## Ignore duplicados e retorne a row existente

`.on_conflict_do_nothing(...)` indica as colunas de um índice único — um field `@unique`, um grupo `@@uniques([...])` ou a primary key. Uma row cujos valores colidem com uma row existente nessas colunas é ignorada em vez de falhar com `CreateError::UniqueViolation`, e a row existente fica como está:

```rust
insert_into::<User>()
    .values(&user)
    .on_conflict_do_nothing(|x| x.email)
    .execute(&client)
    .await?; // Ok(()) com o email já usado ou não
```

Acrescente `.returning::<S>()` ou `.pluck(...)` e a chamada retorna a row desses valores: a que ela inseriu, ou a que já estava lá. Assim um "busca ou cria" vira uma chamada só:

```rust
// O usuário com esse email, novo ou existente.
let user = insert_into::<User>()
    .values(&user)
    .on_conflict_do_nothing(|x| x.email)
    .returning::<User>()
    .execute(&client)
    .await?;

let user_id = insert_into::<User>()
    .values(&user)
    .on_conflict_do_nothing(|x| x.email)
    .pluck(|x| x.id)
    .execute(&client)
    .await?;
```

`.transform(...)` funciona depois de `.returning::<S>()` como sempre. Chame `.on_conflict_do_nothing(...)` antes de `.returning::<S>()` ou `.pluck(...)`; antes ou depois de `.values(...)` tanto faz.

### Várias rows e chaves compostas

Com `insert_many`, as rows novas são inseridas e as que colidem são ignoradas, então um duplicado não derruba mais o lote inteiro. `.returning::<S>()` e `.pluck(...)` retornam uma row por payload, na ordem dos payloads — inserida ou existente:

```rust
let tags = insert_many::<Tag>()
    .values(&tags)
    .on_conflict_do_nothing(|x| x.slug)
    .returning::<Tag>()
    .execute(&client)
    .await?; // tags[i] corresponde ao i-ésimo payload
```

Dois payloads com a mesma chave no mesmo lote inserem uma row só, e os dois recebem essa row. Para um índice único com várias colunas, passe uma tupla de até quatro fields:

```rust
insert_into::<Member>()
    .values(&member)
    .on_conflict_do_nothing(|x| (x.tenant_id, x.handle))
    .returning::<Member>()
    .execute(&client)
    .await?;
```

### Como roda

PostgreSQL e SQLite rodam `INSERT ... ON CONFLICT (email) DO NOTHING`; o MySQL roda `INSERT ... ON DUPLICATE KEY UPDATE email = email`, que deixa a row existente inalterada. Com `.returning::<S>()` ou `.pluck(...)`, mais uma query lê as rows de volta pelos valores das colunas do alvo: um `SELECT` simples para uma row, um `SELECT` com join nas chaves do lote para várias. Dentro de uma [transaction](/pt-br/docs/orm/orm/transactions) as duas rodam na conexão da transaction, e como uma row ignorada não gera erro, a transaction continua utilizável — o PostgreSQL aborta a transaction em qualquer statement que falha, então capturar um `UniqueViolation` ali nunca foi uma opção.

### Requisitos

- PostgreSQL e SQLite só aceitam como alvo as colunas de um índice único, e não de um [parcial](/pt-br/docs/orm/guide/indexes#indices-parciais) (`@unique<...>`); qualquer outra lista falha com `CreateError::Database`. Um conflito em outro índice único continua falhando com `UniqueViolation`.
- O MySQL não tem alvo de conflito: um duplicado em qualquer índice único da tabela é ignorado. Com `.returning::<S>()`/`.pluck(...)`, uma row ignorada por causa de outro índice não é encontrada pelos valores do alvo, e a chamada falha com `CreateError::NotReturned`.
- Para ler as rows de volta, todo payload precisa de um valor em cada coluna do alvo: `NULL` nunca colide, então não encontra a sua row, e uma coluna que o banco gera (`autoincrement()`) não faz parte do insert. Os dois casos falham com `CreateError::InvalidOperation` antes de inserir qualquer coisa.
- Relações aninhadas e links many-to-many não são inseridos: um payload que traga algum falha com `CreateError::InvalidOperation`. Models com relações funcionam desde que esses fields estejam vazios.
- As outras constraints — foreign keys, `NOT NULL`, `CHECK` — falham como sempre.

## Trate erros de insert

`insert_into` e `insert_many` retornam `Result<_, CreateError>` em todo `execute` — simples, `.returning::<S>()`, `.pluck(...)` e `.transform(...)`. Cada violação de constraint tem sua própria variante, então os casos comuns podem ser tratados direto num `match`, sem inspecionar a mensagem de erro (para ignorar duplicados em vez de falhar, veja [Ignore duplicados e retorne a row existente](#ignore-duplicados-e-retorne-a-row-existente)):

```rust
use dinoco::{CreateError, insert_into};

match insert_into::<User>().values(&user).execute(&client).await {
    Ok(()) => {}
    Err(CreateError::UniqueViolation { columns, .. }) => {
        // ex.: columns == ["email"]: responda com 409 Conflict.
    }
    Err(CreateError::ForeignKeyViolation { .. }) => {
        // Uma row referenciada não existe.
    }
    Err(error) => return Err(error.into()),
}
```

| Variante | Quando |
| --- | --- |
| `UniqueViolation { table, constraint, columns, source }` | Um índice unique ou a primary key já contém o valor |
| `ForeignKeyViolation { table, constraint, columns, source }` | Uma foreign key aponta para uma row que não existe |
| `NotNullViolation { table, constraint, columns, source }` | Uma coluna `NOT NULL` recebeu `NULL` |
| `CheckViolation { table, constraint, columns, source }` | Uma constraint `CHECK` rejeitou a row |
| `NotReturned { table }` | `.returning::<S>()`/`.pluck(...)` não conseguiu ler de volta a row inserida (ou, com `on_conflict_do_nothing`, a existente) |
| `InvalidOperation(String)` | `on_conflict_do_nothing` recebeu um payload que não consegue inserir ou ler de volta (veja [Requisitos](#requisitos)) |
| `Decode(DatabaseError)` | A row retornada não pôde ser decodificada em `S` |
| `Database(DatabaseError)` | Qualquer outra falha do driver |

A variante é escolhida a partir do código de erro estruturado do driver — extended codes do SQLite, SQLSTATE do PostgreSQL, números de erro do MySQL — nunca a partir do texto da mensagem. `table`, `constraint` e `columns` são best effort: o PostgreSQL os reporta como campos estruturados, enquanto SQLite e MySQL só os citam na mensagem, então um campo fica `None`/vazio quando o banco não o menciona (o SQLite, por exemplo, nunca nomeia as colunas de uma falha de foreign key, e o MySQL reporta o nome do índice de uma violação unique em vez das colunas).

Alguns helpers cobrem as checagens comuns sem um `match` completo:

```rust
if let Err(error) = insert_into::<User>().values(&user).execute(&client).await {
    if error.is_unique_violation() {
        println!("já em uso: {:?}", error.columns());
    }

    // O mesmo que a variante, como enum portável: Some(DatabaseConstraintError::UniqueViolation), ...
    let kind = error.constraint();

    // O erro original do rusqlite / tokio-postgres / mysql_async.
    let driver_error = error.database_error().map(|error| error.original());
}
```

`CreateError` implementa `std::error::Error`, então `?` continua convertendo para `anyhow::Error` — código que já propaga erros de insert continua compilando, e `error.downcast_ref::<CreateError>()` recupera o valor tipado depois. Dentro de uma closure `transaction(...)` o mesmo erro volta como `TransactionError::Create(CreateError)`; veja [Transactions](/pt-br/docs/orm/orm/transactions#erros-tipados).
