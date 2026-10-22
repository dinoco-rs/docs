# Find many

`find_many` retorna todas as rows compatíveis como `Vec<M>`. Zero correspondências é um resultado perfeitamente normal aqui — você recebe um vetor vazio de volta, nunca um erro.

## Consulta básica

```rust
let accounts = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .execute(&client)
    .await?;
```

Várias chamadas `where_` se combinam com `AND`. Use [Where complex](/pt-br/docs/orm/orm/where-complex) no momento em que precisar de precedência explícita entre `AND`, `OR` e `NOT`.

## Ordene os resultados

```rust
let accounts = dinoco::find_many::<Account>()
    .order_by(|account| account.created_at.desc())
    .execute(&client)
    .await?;
```

Ordene por qualquer field com `asc()` ou `desc()`. Cada chamada de `order_by` adiciona uma coluna depois das anteriores, então empates na primeira coluna são desfeitos pela próxima:

```rust
// Mais novas primeiro; contas criadas no mesmo instante, pelo id.
let accounts = dinoco::find_many::<Account>()
    .order_by(|account| account.created_at.desc())
    .order_by(|account| account.id.asc())
    .execute(&client)
    .await?;
```

Isso compila para `ORDER BY created_at DESC, id ASC`. O mesmo vale para `find_first`, `pluck` e [includes](/pt-br/docs/orm/orm/includes#ordene-e-pagine-a-relacao).

## Paginação

`take` limita quantas rows voltam; `skip` define quantas pular antes de começar a contar:

```rust
let page = dinoco::find_many::<Account>()
    .order_by(|account| account.id.asc())
    .take(25)
    .skip(50)
    .execute(&client)
    .await?;
```

`skip` também funciona sem `take`, retornando todas as rows depois das puladas. SQLite e MySQL só aceitam `OFFSET` depois de um `LIMIT`, então o Dinoco escreve ali o valor "sem limite" de cada um (`LIMIT -1` e `LIMIT 18446744073709551615`); o PostgreSQL aceita `OFFSET` sozinho.

> [!WARNING]
> Paginação por offset (`take`/`skip`) só produz uma sequência de páginas estável e sem sobreposição quando combinada com um `order_by` estável. Pagine sem ordenar — ou ordene por uma coluna com empates, tipo um field de status — e rows podem aparecer em duas páginas ou sumir entre elas conforme os dados por baixo mudam. Termine a ordenação com uma coluna única, como `.order_by(|x| x.id.asc())`, para desfazer todo empate.

## Busca full-text

Todo field marcado com `@fulltext` expõe um method correspondente:

```rust
let accounts = dinoco::find_many::<Account>()
    .where_(|account| account.biography.fulltext("rust database"))
    .execute(&client)
    .await?;
```

Veja [Busca full-text](/pt-br/docs/orm/orm/full-text-search) para como isso se comporta diferente em cada adapter.

## Selecione e inclua

```rust
let accounts = dinoco::find_many::<Account>()
    .select::<AccountSummary>()
    .execute(&client)
    .await?;
```

O tipo de retorno vira `Vec<AccountSummary>` em vez de `Vec<Account>`. `includes(...)` funciona junto com `select`, e pode filtrar, ordenar e paginar as rows relacionadas independentemente da query pai — veja [Select](/pt-br/docs/orm/orm/select) e [Includes](/pt-br/docs/orm/orm/includes).

## Pluck em uma única coluna

`pluck` projeta sobre uma coluna e retorna seus valores diretamente, em vez de um struct de row-model:

```rust
let ids = dinoco::find_many::<Account>()
    .where_(|account| account.active.eq(true))
    .pluck(|account| account.id)
    .execute(&client)
    .await?; // Vec<i64>
```

Diferente de `select::<S>()`, `pluck` nunca constrói `S` — a coluna volta como `Vec<T>` (um `String`, `bool`, `i64`, `f64`, data, enum, ou valor JSON, de acordo com o tipo do field). Ele substitui `select`/`includes` em vez de se combinar com eles.

## Agregue uma coluna

Passe para o `pluck` uma agregação em vez de um field — `sum`, `avg`, `min`, `max` ou `count` — e o banco calcula o valor sobre as rows encontradas. Volta um valor só, não um `Vec`:

```rust
let revenue = dinoco::find_many::<Order>()
    .where_(|order| order.status.eq(OrderStatus::Paid))
    .pluck(|order| order.amount.sum())
    .execute(&client)
    .await?; // i64
```

| Agregação | Fields | Retorna | Sem nenhuma row |
| --- | --- | --- | --- |
| `sum()` | `Integer`, `Float` | `i64`, `f64` | `0` |
| `avg()` | `Integer`, `Float` | `Option<f64>` | `None` |
| `min()`, `max()` | `Integer`, `Float`, `String`, `DateTime`, `Date` | `Option<T>` | `None` |
| `count()` | qualquer field escalar | `i64` | `0` |

Fields opcionais também funcionam, e valores `NULL` ficam de fora: `discount.sum()` soma os pedidos que têm desconto, e `discount.count()` conta só esses. `count()` num field que nunca é `NULL`, como a primary key, conta rows. Uma soma volta com o mesmo tipo em todo banco — o Dinoco converte as somas `numeric` do PostgreSQL e `DECIMAL` do MySQL de volta para `i64`/`f64`, então não sobra tipo decimal para converter.

### Rows da agregação

A agregação lê exatamente as rows que o `find_many` retornaria. `where_`, `where_complex` e [filtros de relação](/pt-br/docs/orm/orm/relation-filters) restringem essas rows, e `take`/`skip` agregam uma janela delas, com o `order_by` decidindo quais rows ficam na janela:

```rust
// O total dos 10 maiores pedidos pagos.
let top_ten = dinoco::find_many::<Order>()
    .where_(|order| order.status.eq(OrderStatus::Paid))
    .order_by(|order| order.amount.desc())
    .take(10)
    .pluck(|order| order.amount.sum())
    .execute(&client)
    .await?;

// Quanto os clientes VIP gastaram.
let vip = dinoco::find_many::<Order>()
    .where_(|order| order.customer.where_(|customer| customer.vip.eq(true)))
    .pluck(|order| order.amount.sum())
    .execute(&client)
    .await?;
```

Sem `take` nem `skip`, o `order_by` não muda o resultado, então fica fora do SQL.

## Agrupe a agregação

`.group_by(...)` depois de uma agregação calcula o valor uma vez por grupo de rows com a mesma chave, e retorna `Vec<(chave, valor)>`:

```rust
let revenue_by_status = dinoco::find_many::<Order>()
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.status)
    .execute(&client)
    .await?; // Vec<(OrderStatus, i64)>
```

Qualquer field escalar pode ser a chave, incluindo enums e fields opcionais. `NULL` forma um grupo próprio, que volta como `None`. `where_`, `where_complex` e filtros de relação continuam escolhendo as rows que entram nos grupos.

### Agrupe por data e hora

Num field `DateTime` ou `Date`, `date()`, `week()`, `month()` e `year()` agrupam pelo período em que o valor cai. A chave é o primeiro dia desse período como `NaiveDate` (a semana começa na segunda-feira), ou `Option<NaiveDate>` para um field opcional. `date()` agrupa pela data completa (dia, mês e ano); `day()` é o mesmo method com outro nome.

Num field `DateTime`, `hour()` e `minute()` agrupam pela hora ou pelo minuto do valor. A chave é o instante em que o período começa, como `DateTime<Utc>` (`Option<DateTime<Utc>>` para um field opcional): 18:30:42 cai na hora 18:00:00 e no minuto 18:30:00.

| Method | Fields | Chave de `2026-01-05 18:30:42` |
| --- | --- | --- |
| `date()`, `day()` | `DateTime`, `Date` | `2026-01-05` |
| `week()` | `DateTime`, `Date` | `2026-01-05` (a segunda-feira) |
| `month()` | `DateTime`, `Date` | `2026-01-01` |
| `year()` | `DateTime`, `Date` | `2026-01-01` |
| `hour()` | `DateTime` | `2026-01-05 18:00:00` |
| `minute()` | `DateTime` | `2026-01-05 18:30:00` |

```rust
use dinoco::chrono::{DateTime, NaiveDate, Utc};

let daily: Vec<(NaiveDate, i64)> = dinoco::find_many::<Order>()
    .where_(|order| order.created_at.gte(start))
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.date())
    .execute(&client)
    .await?;

for (day, total) in daily {
    println!("{}: {total}", day.format("%d/%m/%Y"));
}

let hourly: Vec<(DateTime<Utc>, i64)> = dinoco::find_many::<Order>()
    .where_(|order| order.created_at.gte(start))
    .pluck(|order| order.id.count())
    .group_by(|order| order.created_at.hour())
    .execute(&client)
    .await?;
```

Os períodos seguem os valores UTC que o Dinoco grava, então um dia vai de 00:00 a 24:00 UTC e uma hora começa no minuto zero UTC. A chave é uma data ou um instante, não texto: formate do jeito que precisar, como o `day.format("%d/%m/%Y")` acima. Para contar os dias em outro fuso horário, veja a próxima seção.

### Agrupe por data num fuso horário

`.with_timezone(&zone)` depois de `date()`, `day()`, `week()`, `month()` ou `year()` calcula o período nesse fuso em vez de UTC: cada instante conta no dia em que cai lá, horário de verão incluído. Os fusos vêm do [`chrono_tz`](https://docs.rs/chrono-tz), reexportado como `dinoco::chrono_tz`:

```rust
use dinoco::chrono_tz::America::Sao_Paulo;

// Vendas por dia no horário de São Paulo (UTC-3): um pedido às 01:00 UTC de
// 6 de janeiro conta em 5 de janeiro.
let daily = dinoco::find_many::<Order>()
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.date().with_timezone(&Sao_Paulo))
    .execute(&client)
    .await?; // Vec<(NaiveDate, i64)>
```

A chave continua sendo o primeiro dia do período, agora no calendário desse fuso. Filtros, `order_by`, `take` e `skip` funcionam como sempre, e também fields opcionais (`NULL` continua sendo um grupo próprio) e transactions.

- Num field `Date`, o fuso não muda nada: uma data de calendário é a mesma em todo fuso.
- `hour()` e `minute()` não recebem fuso; continuam em UTC.
- O PostgreSQL converte com `AT TIME ZONE`, e o SQLite com uma função que o Dinoco registra em cada conexão, baseada nos mesmos dados do `chrono_tz`. Nenhum dos dois precisa de mais nada.
- O MySQL converte com `CONVERT_TZ`, que lê os fusos nomeados das tabelas de fuso horário dele. Elas vêm carregadas na imagem Docker oficial e na maioria dos serviços gerenciados, mas nem sempre numa instalação local: carregue com o [`mysql_tzinfo_to_sql`](https://dev.mysql.com/doc/refman/8.4/en/time-zone-support.html). Antes dessa query, o Dinoco confere o fuso com um `SELECT` a mais e falha com essa dica, em vez de agrupar todas as rows sob `NULL`.

### Ordene e pagine os grupos

Com um grupo, `order_by`, `take` e `skip` valem para os grupos em vez das rows:

- sem `order_by`, os grupos vêm pela chave, em ordem crescente;
- `order_by` no field agrupado ordena pela chave;
- `order_by` no field agregado ordena pelo valor da agregação, com empates desfeitos pela chave, em ordem crescente;
- um segundo `order_by`, no field agrupado, escolhe a direção desse desempate: `.order_by(|o| o.amount.desc()).order_by(|o| o.customer_id.desc())`;
- `take` e `skip` paginam os grupos.

```rust
// Os 7 dias mais recentes com pedidos, do mais novo para o mais antigo.
let last_days = dinoco::find_many::<Order>()
    .order_by(|order| order.created_at.desc())
    .take(7)
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.created_at.day())
    .execute(&client)
    .await?;

// Os 3 clientes que mais gastaram.
let best_customers = dinoco::find_many::<Order>()
    .where_(|order| order.customer_id.not_null())
    .order_by(|order| order.amount.desc())
    .take(3)
    .pluck(|order| order.amount.sum())
    .group_by(|order| order.customer_id)
    .execute(&client)
    .await?; // Vec<(Option<String>, i64)>
```

`order_by` em qualquer outro field faz a query falhar com um erro, já que um grupo não tem um valor único dessa coluna para ordenar.

> [!NOTE]
> A posição das chaves `NULL` depende do banco (no fim no PostgreSQL, no começo no SQLite e no MySQL), e a ordem de chaves enum também (ordem de declaração nos enums do PostgreSQL e do MySQL, alfabética no SQLite). Quando a ordem importa, ordene pela agregação ou ordene o `Vec` no Rust.

## Transforme os resultados

`transform` roda uma closure Rust simples sobre cada row depois que a query (e qualquer `.includes(...)`) já rodou — é um mapeamento pós-query, não uma projeção SQL:

```rust
let summaries = dinoco::find_many::<Account>()
    .transform(|account| serde_json::json!({
        "id": account.id,
        "email": account.email,
    }))
    .execute(&client)
    .await?; // Vec<serde_json::Value>
```

Como a closure recebe a row já totalmente materializada, ela pode ler fields vindos de `.includes(...)`, remodelar dados para uma resposta de API, ou converter para um tipo completamente diferente.

## Leia no primary

`read_in_primary()` roteia essa query — e toda relação que ela `.includes(...)` — para longe das réplicas e direto para a primary. Use isso especificamente quando a leitura depende de um write que acabou de acontecer e não pode tolerar lag de replicação.

## Dentro de uma transaction

Passe o `tx` de uma closure [`transaction(...)`](/pt-br/docs/orm/orm/transactions#leia-dentro-de-uma-transaction) em vez de `&client` para ler na conexão da transaction. As rows refletem todo write que a closure fez até ali, e `.includes(...)`, `.pluck(...)` (com agregações e grupos) e `.transform(...)` rodam lá também:

```rust
dinoco::transaction(&client, |tx| async move {
    dinoco::insert_many::<Task>().values(&tasks).execute(tx).await?;

    let open = dinoco::find_many::<Task>()
        .where_(|x| x.project_id.eq(&project_id))
        .pluck(|x| x.id)
        .execute(tx)
        .await?;

    Ok(open)
})
.await?;
```
