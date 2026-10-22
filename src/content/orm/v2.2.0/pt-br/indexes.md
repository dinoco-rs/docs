# Índices e constraints

Índices no Dinoco são declarados direto no `schema.dinoco`, junto dos fields que cobrem, e passam pelo mesmo pipeline de migration, introspecção e detecção de drift que as tabelas — não existe uma etapa separada de "gerenciamento de índices". Esta página cobre índices comuns e unique explícitos (incluindo os parciais), os índices que o Dinoco cria automaticamente, e busca full-text.

## Escolha o tipo de índice

| Necessidade | Declaração | Resultado |
| --- | --- | --- |
| Acelerar igualdade, ordenação ou range | `@index` | Índice B-tree não único |
| Acelerar um grupo ordenado de fields | `@@indexes([...])` | Índice composto não único |
| Impedir duplicatas em um grupo | `@@uniques([...])` | Índice unique composto |
| Indexar ou restringir só algumas rows | `@index<...>`, `@unique<...>`, `@@indexes<...>([...])`, `@@uniques<...>([...])` | [Índice parcial](#indices-parciais) |
| Pesquisar tokens em texto | `@fulltext` | GIN no PostgreSQL, `FULLTEXT` no MySQL e fallback no SQLite |
| Pesquisar um documento formado por vários fields | `@@fulltexts([...])` | Full-text composto nativo ou fallback SQLite |
| Primary key | `@id` ou `@@ids` | Índice automático da constraint |
| Foreign key | `@relation(fields: [...])` | Índice automático nas colunas locais |

> [!NOTE]
> Indexação comum e full-text são duas estratégias diferentes, não um espectro — um field não pode participar das duas. `@index`/`@@indexes` e `@fulltext`/`@@fulltexts` são mutuamente exclusivos no mesmo field.

## Declare um índice explícito

Adicione `@index` diretamente a um field escalar ou enum:

```dinoco
model Post {
    id           String   @id @default(uuid())
    slug         String   @index
    published_at DateTime @index(map: "idx_post_publication")
}
```

Sem `map`, o nome físico do índice segue `idx_<tabela>_<field>` automaticamente. Passe `map` quando precisar de um nome específico — por exemplo, para casar com um índice já existente numa migration vinda de outra ferramenta. De qualquer forma, `@index` nunca implica unicidade por si só; use `@unique` quando valores duplicados devem ser rejeitados.

## Declare índices e unicidade compostos

Declarações compostas são atributos de model, colocados no final do corpo do model:

```dinoco
model Article {
    tenant_id String
    id        String
    slug      String
    category  String
    title     String
    body      String?

    @@ids([tenant_id, id])
    @@uniques([tenant_id, slug])
    @@indexes([tenant_id, category])
    @@fulltexts([title, body])
}
```

`@@uniques` rejeita tuplas duplicadas no nível do banco e produz um índice unique composto; `@@indexes` produz o mesmo formato sem a constraint de unicidade. Os dois preservam fielmente a ordem dos fields durante migration, introspecção e comparação de drift — ordem importa para a utilidade de um índice composto, então o Dinoco nunca a reordena silenciosamente. Um model pode declarar vários atributos `@@uniques`/`@@indexes`/`@@fulltexts` quando precisa de mais de um grupo distinto.

> [!TIP]
> Todo array aqui precisa ser não vazio, referenciar fields que realmente existem no model, e não repetir nenhum field — e o formatter sempre move declarações `@@...` para depois dos fields, então não se preocupe em qual lugar do corpo do model você as escreve.

## Índices parciais

Coloque uma condição entre `<` e `>` logo depois de `@unique`, `@index`, `@@uniques` ou `@@indexes`, e o índice cobre só as rows que batem com ela:

```dinoco
enum Plan {
    FREE
    PRO
}

model Account {
    id         String    @id
    email      String?   @unique<email != null>
    handle     String?   @index<handle != null>(map: "account_handle_key")
    tenant     String
    slug       String
    plan       Plan
    archived   Boolean
    deleted_at DateTime?
    score      Integer

    @@uniques<deleted_at == null && slug != "_">([tenant, slug])
    @@indexes<plan == PRO || score >= 10>([tenant, score])
}
```

Um índice unique parcial só rejeita duplicatas entre as rows que batem com a condição. Acima, uma conta apagada com soft delete libera o seu `(tenant, slug)` para uma nova, e qualquer número de contas pode usar o slug provisório `"_"`. Um índice comum parcial é menor e mais barato de manter atualizado, e atende às queries cujo filtro implica a condição.

### Escreva uma condição

Uma condição compara fields do próprio model com um valor, e combina comparações com `&&`, `||`, `!` e parênteses (`&&` tem precedência sobre `||`):

| Tipo do field | Valores | Operadores |
| --- | --- | --- |
| Qualquer field escalar ou enum | `null` | `==`, `!=` |
| `Boolean` | `true`, `false`, ou o field sozinho (`archived`, `!archived`) | `==`, `!=` |
| `Integer`, `Float` | números (`10`, `-1.5`) | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| `String`, `DateTime`, `Date` | strings (`"_"`, `"2026-01-01"`) | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| Enum | um valor do enum, sem ou com aspas (`PRO`, `"PRO"`) | `==`, `!=` |

Fields `Json` e fields de relação não podem aparecer numa condição, e um field de relação não aceita uma: coloque o `@unique<...>` no field da foreign key. O formatter escreve as condições nesta forma canônica, com espaços em volta dos operadores e só os parênteses que a precedência exige.

### Como cada banco guarda

| Banco | Índice unique parcial | Índice comum parcial |
| --- | --- | --- |
| PostgreSQL | `CREATE UNIQUE INDEX ... WHERE <condição>` | `CREATE INDEX ... WHERE <condição>` |
| SQLite | `CREATE UNIQUE INDEX ... WHERE <condição>` | `CREATE INDEX ... WHERE <condição>` |
| MySQL | Um índice unique com a chave `(CASE WHEN <condição> THEN coluna END)` em cada coluna (MySQL 8.0.13+) | Um índice comum sobre todas as rows |

O MySQL não tem índices parciais. Num unique, cada parte da chave é `NULL` fora da condição, e `NULL`s nunca colidem, então as mesmas rows são rejeitadas que nos outros bancos. Um índice comum no MySQL cobre todas as rows, o que continua atendendo às mesmas queries.

Todo banco também guarda a condição na sintaxe do próprio Dinoco junto do índice (um comentário SQL na definição do índice no SQLite, `COMMENT ON INDEX` no PostgreSQL, o `COMMENT` do índice no MySQL), e é isso que a detecção de drift compara. Mudar, acrescentar ou remover uma condição faz o `migrate generate` apagar e recriar o índice.

> [!WARNING]
> Um índice unique parcial não torna um field único em todas as rows, então ele não serve de chave para relações: uma relação one-to-one continua precisando de um `@unique` ou `@@uniques` sem condição, assim como um field referenciado pela relação de outro model. No PostgreSQL e no SQLite, o [`on_conflict_do_nothing`](/pt-br/docs/orm/orm/insert#ignore-duplicados-e-retorne-a-row-existente) também não consegue mirar um índice unique parcial, já que esses bancos só aceitam um alvo de conflito que corresponda a um índice unique inteiro.

## Primary keys são indexadas

Todo field `@id` já é indexado, pela própria constraint `PRIMARY KEY` — o Dinoco rastreia esse índice no seu modelo interno de comparação (para que a detecção de drift saiba que ele já está contabilizado), mas nunca emite um segundo `CREATE INDEX` redundante para ele.

Uma primary key composta mantém a ordem declarada de fields nesse mesmo índice:

```dinoco
model Membership {
    tenant_id String
    user_id   String

    @@ids([tenant_id, user_id])
}
```

O banco acaba com um único índice composto sobre `(tenant_id, user_id)`, nessa ordem — útil para queries que filtram só por `tenant_id`, menos para queries que filtram só por `user_id`.

## Foreign keys são indexadas

Toda relação materializada ganha um índice automático sobre seus `fields`, sem precisar de `@index`:

```dinoco
model Session {
    id         String   @id @default(uuid())
    account_id String
    account    Account? @relation(
        fields: [account_id],
        references: [id]
    )
}
```

Isso gera `idx_session_account_id`. Uma relação composta (múltiplos `fields`) ganha um único índice composto, na mesma ordem em que a relação os declara.

Tabelas pivô de many-to-many implícito ganham três índices automaticamente:

1. O índice da primary key composta.
2. Um índice na foreign key do primeiro lado.
3. Um índice na foreign key do segundo lado.

> [!WARNING]
> Não adicione `@index` a um field só porque ele já faz parte de `@id` ou `@relation` — isso pede ao Dinoco para criar um segundo índice redundante ao lado do automático, gastando capacidade de escrita e espaço em disco sem benefício nenhum para as queries.

## Índices full-text

`@fulltext` só funciona em `String` ou `String?`:

```dinoco
model Article {
    id      String  @id @default(uuid())
    title   String  @fulltext
    summary String? @fulltext
}
```

Um model pode ter vários fields `@fulltext` **independentes**, cada um pesquisável por conta própria. `@@fulltexts([title, summary])` é uma coisa bem diferente: ele constrói *um* documento ordenado a partir dos dois fields e o apoia em *um* índice nativo, então chamar `.fulltext(...)` em qualquer um dos fields gerados pesquisa o grupo combinado inteiro. No SQLite — que não tem índice full-text nativo — o Dinoco pula a criação de um B-tree que não ajudaria em nada, e em vez disso pesquisa cada field do grupo com `LIKE '%termo%'`, unido por `OR`.

Veja [Busca full-text](/pt-br/docs/orm/orm/full-text-search) para como `.fulltext(...)` aparece em cada find builder.

## Fluxo de migration

Igual a qualquer outra mudança de schema — depois de editar um índice:

```bash
dinoco migrate generate
dinoco migrate run
```

O planner emite `CREATE INDEX`, `DROP INDEX`, ou a variante full-text específica do adapter ativo, conforme necessário. A introspecção compara nome, colunas, ordem, tipo e condição de cada índice contra o que o schema descreve atualmente, então um índice alterado fora do Dinoco ainda é detectado como drift.

## Nomes de índice longos

O PostgreSQL guarda no máximo 63 bytes de um nome e corta o resto sem avisar; o MySQL recusa nomes com mais de 64 caracteres. Os nomes gerados crescem com os nomes da tabela e dos fields, então podem passar desses limites:

```dinoco
model BusinessReceivableTransaction {
    id          Integer   @id @default(autoincrement())
    business_id Integer
    executed_at DateTime?
    unlock_at   DateTime

    @@indexes([business_id, executed_at, unlock_at])
}
```

O nome completo, `idx_business_receivable_transaction_business_id_executed_at_unlock_at`, tem 71 caracteres. O Dinoco corta todo nome gerado de índice, unique, full-text e foreign key no limite do banco, do mesmo jeito que o PostgreSQL, então a migration cria o nome que o banco guarda e a introspecção o encontra de novo:

| Banco      | Limite         | Nome do índice                                                      |
| ---------- | -------------- | ------------------------------------------------------------------- |
| PostgreSQL | 63 bytes       | `idx_business_receivable_transaction_business_id_executed_at_unl`  |
| MySQL      | 64 caracteres  | `idx_business_receivable_transaction_business_id_executed_at_unlo` |
| SQLite     | nenhum         | `idx_business_receivable_transaction_business_id_executed_at_unlock_at` |

Quando dois nomes da mesma tabela ficam iguais depois do corte, o segundo ganha um sufixo `_2` (depois `_3`, ...) que ainda cabe no limite. Um nome passado com `map` é cortado do mesmo jeito. As tabelas pivô implícitas de many-to-many e suas colunas seguem a mesma regra.

> [!NOTE]
> Antes da v2.1.5, o PostgreSQL cortava esses nomes por conta própria enquanto o Dinoco continuava comparando com o nome completo, então todo `dinoco migrate` reportava `Missing index` e `Unexpected index` para o mesmo índice. Os nomes cortados batem com o que o PostgreSQL já guardou, então atualizar não precisa de migration.

Nomes escolhidos por você nunca são cortados: um nome de tabela, coluna ou enum maior que o limite faz o `migrate generate` parar antes de conectar, listando cada um desses nomes. Encurte-os, dando a um model longo um `@@table_name("...")` mais curto. Do contrário o PostgreSQL cortaria o nome por conta própria, e o banco nunca bateria com o schema, e o MySQL recusaria a migration no meio.

## Regras de validação

- `@index` aceita somente o argumento opcional `map: "nome"`.
- `@index` só funciona em fields escalares e enums — nunca em um field de relação.
- `@fulltext` não aceita argumento nenhum.
- `@fulltext` só funciona em `String` e `String?`.
- Um field nunca pode pertencer ao mesmo tempo a uma declaração comum e uma full-text, inclusive nas formas compostas.
- Vários fields `@fulltext` são permitidos no mesmo model.
- Todo membro de `@@fulltexts` precisa ser `String` ou `String?`, e pode pertencer a no máximo uma declaração full-text.
- `@@uniques`, `@@indexes` e `@@fulltexts` podem, cada um, ser repetidos para grupos de fields diferentes e independentes. Os mesmos fields podem se repetir com outra condição.
- Só `@unique`, `@index`, `@@uniques` e `@@indexes` aceitam uma condição, e nunca na primary key nem num field de relação. Uma condição lê fields do próprio model e compara cada um com um valor do tipo do field (veja [Escreva uma condição](#escreva-uma-condicao)).
