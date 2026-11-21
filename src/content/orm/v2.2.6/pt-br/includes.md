# Includes

`includes(...)` é como você opta por carregar um field de relação. Sem ele, relações mantêm o valor vazio com que são geradas: `Vec::new()` para uma relação "muitos", `None` para uma "um" — o Dinoco nunca carrega dado que você não pediu.

## Inclua uma relação many

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| account.sessions())
    .execute(&client)
    .await?;
```

O Dinoco primeiro reúne a chave de cada parent, depois carrega todos os children compatíveis numa única query de acompanhamento em lote — nunca uma query por linha de parent.

## Inclua uma relação one

```rust
let session = dinoco::find_first::<AccountSession>()
    .where_(|session| session.id.eq(&session_id))
    .includes(|session| session.account())
    .execute(&client)
    .await?;
```

Relações "um" usam uma estratégia equivalente a left join e ficam `None` graciosamente quando nada corresponde — um include "um" sem correspondência não é um erro.

## Filtre a relação

O builder de relação dentro de `.includes(...)` expõe os mesmos filtros gerados que um find de nível superior:

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| account.sessions().where_(|session| session.revoked.eq(false)))
    .execute(&client)
    .await?;
```

Filtros de relação funcionam ali também, então um include pode carregar só as rows relacionadas que têm (ou não têm) rows relacionadas próprias: `.where_(|session| session.devices.where_(|device| device.trusted.eq(true)))`.

O `where_` do include escolhe quais rows relacionadas são carregadas em cada parent; ele nunca remove um parent do resultado. Para retornar só os parents que têm rows relacionadas compatíveis, filtre o parent com um [filtro de relação](/pt-br/docs/orm/orm/relation-filters) — os dois se combinam:

```rust
let accounts = dinoco::find_many::<Account>()
    .where_(|account| account.sessions.where_(|session| session.revoked.eq(false)))
    .includes(|account| account.sessions().where_(|session| session.revoked.eq(false)))
    .execute(&client)
    .await?;
```

## Ordene e pagine a relação

`order_by`, `take` e `skip` no builder de relação ordenam e paginam as rows relacionadas de **cada parent**:

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| {
        account
            .sessions()
            .where_(|session| session.revoked.eq(false))
            .order_by(|session| session.created_at.desc())
            .order_by(|session| session.id.desc())
            .skip(1)
            .take(5)
    })
    .execute(&client)
    .await?;
```

Como no nível superior, cada `order_by` adiciona uma coluna depois das anteriores, então sessions criadas no mesmo instante são ordenadas pelo `id`.

> [!NOTE]
> Numa relação "muitos", `take(5)` se aplica **por parent**, não ao resultado combinado de todos os parents — cada account recebe até cinco de suas próprias sessions, depois de pular a primeira dela. Por baixo dos panos, o compiler consegue isso com uma query com window partition, em vez de disparar uma query separada por parent.

A paginação funciona em toda relação "muitos", incluindo many-to-many e auto-relações, e em todo nível de [includes aninhados](#faca-includes-aninhados). `take(0)` carrega uma lista vazia, e um `skip` depois da última row de um parent carrega uma lista vazia para esse parent. Sem `order_by`, quais rows uma página mantém fica a critério do banco.

## Use where complex e full-text

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| {
        account.sessions().where_complex(|session, m| {
            m.and([
                session.label.fulltext("mobile"),
                m.not(session.revoked.eq(true)),
            ])
        })
    })
    .execute(&client)
    .await?;
```

A mesma regra dos finds de nível superior vale aqui: uma vez que um builder de relação usa `where_complex`, todo `where_` comum nesse mesmo builder é ignorado. `.fulltext(...)` só está disponível quando o field relacionado de fato tem `@fulltext` no schema.

## Faça includes aninhados

```rust
let projects = dinoco::find_many::<Project>()
    .includes(|project| project.owner())
    .includes(|project| {
        project
            .tasks()
            .order_by(|task| task.priority.desc())
            .take(10)
            .includes(|task| task.assignee())
    })
    .execute(&client)
    .await?;
```

Includes irmãos — `owner()` e `tasks()` aqui — são aguardados em paralelo em vez de um depois do outro, e cada nível aninhado repete a estratégia de carregamento apropriada para seu próprio tipo de relação (em lote para "muitos", equivalente a left join para "um"), até o fim.

Cada nível aceita seus próprios `where_` (filtros de relação incluídos), `where_complex`, `order_by`, `take` e `skip`. Eles valem só para as rows daquele nível, e as páginas valem por parent naquele nível:

```rust
let projects = dinoco::find_many::<Project>()
    .includes(|project| {
        project
            .tasks()
            // Tasks atribuídas a um usuário ativo.
            .where_(|task| task.assignee.where_(|user| user.active.eq(true)))
            .order_by(|task| task.priority.desc())
            .order_by(|task| task.id.asc())
            .take(10)
            .includes(|task| {
                task.comments()
                    // Comentários cujo autor ainda existe, os 3 mais recentes por task.
                    .where_(|comment| comment.author.exists())
                    .order_by(|comment| comment.created_at.desc())
                    .take(3)
                    .includes(|comment| comment.author())
            })
    })
    .execute(&client)
    .await?;
```

## Agregue a relação

`.pluck(...)` numa relação many carrega agregações das rows relacionadas em vez das rows: uma vez por parent, ou uma vez por grupo delas depois de `.group_by(...)`. O parent volta normalmente, e o field da relação mantém o tipo — ele recebe uma row por grupo, com a chave no field agrupado e cada agregação no field que ela lê:

```rust
let accounts = dinoco::find_many::<Account>()
    .includes(|account| {
        account
            .transactions()
            .where_(|t| t.status.eq(TransactionStatus::Paid))
            .pluck(|t| t.amount.sum())
            .group_by(|t| t.kind)
    })
    .execute(&client)
    .await?;

for transaction in &accounts[0].transactions {
    // Uma `Transaction` por kind: `kind` é a chave, `amount` a soma.
    println!("{:?}: {}", transaction.kind, transaction.amount);
}
```

Todo outro field de uma row de grupo fica no valor default, e um parent sem rows relacionadas recebe uma lista vazia. Os grupos de todos os parents carregam numa query só, como qualquer include, e funciona em relações one-to-many e many-to-many, em includes aninhados e dentro de transactions.

Uma agregação precisa caber no field que ela lê, porque é lá que ela fica: `sum`, `min` ou `max` cabem nele, `avg` só num field `Float`, `count` só num field `Integer`. Se não couber, a query falha com um erro que diz o field. Agrupar um field `DateTime` por `date()`, `week()`, `month()` ou `year()` guarda o primeiro dia do intervalo à meia-noite UTC; `hour()` e `minute()` guardam o próprio intervalo.

### Ordene e pagine os grupos

`where_` e `where_complex` escolhem as rows relacionadas agregadas. Depois de `group_by`, `order_by` no field agrupado ou num field agregado ordena os grupos de cada parent (pela chave, crescente, por padrão), e `take` e `skip` paginam os grupos por parent, como nos [plucks agrupados](/pt-br/docs/orm/orm/find-many#ordene-e-pagine-os-grupos):

```rust
// O kind que mais vendeu em cada account.
.includes(|account| {
    account
        .transactions()
        .order_by(|t| t.amount.desc())
        .take(1)
        .pluck(|t| t.amount.sum())
        .group_by(|t| t.kind)
})
```

Includes aninhados dentro de uma relação agregada não são carregados: uma row de grupo não tem rows relacionadas próprias.

### Várias agregações por grupo

Encadeie `.pluck(...)` para preencher vários fields de cada row de grupo, uma agregação por field:

```rust
.includes(|account| {
    account
        .transactions()
        .pluck(|t| t.amount.sum())
        .pluck(|t| t.charged_fees.sum())
        .pluck(|t| t.taxes.sum())
        .group_by(|t| t.kind)
})
```

Duas agregações do mesmo field cairiam no mesmo lugar, então isso faz a query falhar.

### Grupos como projeção

`.select::<P>()` antes de `.pluck(...)` monta cada grupo como `P`, uma projeção só com os fields que o include preenche, então nenhum field fica com um default sem sentido. A projeção do parent declara a relação como `Vec<P>`:

```rust
#[derive(Debug, Default, EntityExtend)]
#[extend(Transaction)]
pub struct TransactionTotals {
    pub kind: TransactionType,
    pub amount: i64,
    pub charged_fees: i64,
}

#[derive(Debug, EntityExtend)]
#[extend(Account)]
pub struct AccountTotals {
    pub id: String,
    pub transactions: Vec<TransactionTotals>,
}

let accounts = dinoco::find_many::<Account>()
    .select::<AccountTotals>()
    .includes(|account| {
        account
            .transactions()
            .select::<TransactionTotals>()
            .pluck(|t| t.amount.sum())
            .pluck(|t| t.charged_fees.sum())
            .group_by(|t| t.kind)
    })
    .execute(&client)
    .await?;
```

A projeção precisa de `#[derive(Default)]` e de todos os fields que o include preenche; faltando um, a query falha com um erro que diz qual.

## Combine com select

O builder de relação também aceita `select::<S>()`, exatamente como um find de nível superior. A chave da relação é rastreada separadamente da projeção internamente, só para agrupar as rows de volta ao parent correto — a projeção em si nunca precisa expor essa chave como field. Veja [Select](/pt-br/docs/orm/orm/select).

## Primary e transactions

`read_in_primary()` no find pai roteia tanto a row pai *quanto* todo include abaixo dela para a primary — não existe forma de manter um include numa réplica enquanto o pai lê da primary.

Dentro de uma closure [`transaction(...)`](/pt-br/docs/orm/orm/transactions#leia-dentro-de-uma-transaction), passe o `tx` para o `execute`: o pai e todo include, em qualquer profundidade, leem na conexão da transaction e enxergam os writes que a closure fez até ali.
