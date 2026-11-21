# Watch changes

`watch` transmite os inserts, updates e deletes de um model conforme eles são commitados. As mudanças vêm do próprio log do banco, o write-ahead log do PostgreSQL (logical replication) ou o binary log do MySQL, nunca de hooks em volta dos métodos do Dinoco. Por isso um watch enxerga todo writer: seus builders, SQL puro, outro serviço, um console do banco.

```rust
use dinoco::{WatchEvent, watch};

use crate::dinoco::Account;

watch::<Account>()
    .filter(|account| account.active)
    .on_event(|event| match event {
        WatchEvent::Created(account) => println!("criado {}", account.id),
        WatchEvent::Updated { before, after } => println!("{} -> {}", before.email, after.email),
        WatchEvent::Deleted(account) => println!("removido {}", account.id),
    })
    .observer(&client)
    .await?;
```

## Habilite no schema

Declare `@@with_watch_changes` em cada model a transmitir, e `replication_url` no bloco de config:

```dinoco
config {
    database        = "postgresql"
    database_url    = env("DATABASE_URL")
    replication_url = env("REPLICATION_DATABASE_URL")
}

model Account {
    id     String  @id @default(uuid())
    email  String
    active Boolean

    @@with_watch_changes
}
```

`replication_url` é a URL do **usuário de replicação** com que os watches se conectam, um usuário do banco só para isso, que a CLI cria a partir do nome e da senha da URL. Todo schema com um model observado precisa declará-la em cada workspace PostgreSQL e MySQL. No model, o atributo não recebe argumentos.

```bash
export DATABASE_URL="postgres://app:secret@db:5432/app"
export REPLICATION_DATABASE_URL="postgres://app_replica:other-secret@db:5432/app"
```

Depois rode `dinoco migrate generate` (ou `dinoco migrate run` no deploy). O `connect()` gerado lê `REPLICATION_DATABASE_URL` quando ela está definida, então os watches usam esse usuário. Um client montado à mão a recebe com `client.with_replication_url(url)`, e sem ela conecta com a URL da primary, cujo usuário precisa então ter privilégios de replicação.

## O que a CLI configura

Depois de aplicar as migrations, `migrate generate` e `migrate run` comparam os models observados com o banco e criam ou removem o que mudou, mostrando cada mudança numa seção **Watch**:

| | PostgreSQL | MySQL |
| --- | --- | --- |
| Por tabela observada | Uma publication `dinoco_watch_<tabela>` (inserts, updates, deletes) e `REPLICA IDENTITY FULL`, para que updates e deletes registrem a linha anterior inteira | `SELECT` na tabela para o usuário de replicação |
| Usuário de replicação | Um role com `LOGIN REPLICATION`, a senha da URL e `SELECT` nas tabelas observadas | Um usuário com `REPLICATION SLAVE, REPLICATION CLIENT` e a senha da URL |

- **Adicionar o atributo** a um model publica a tabela dele na próxima execução.
- **Removê-lo** de um model remove a publication da tabela e restaura a replica identity padrão (PostgreSQL), ou revoga o `SELECT` (MySQL).
- **Removê-lo de todos os models** também remove o usuário de replicação, desde que o Dinoco o tenha criado: os usuários que o Dinoco cria levam o comentário `dinoco replication user`, e nenhum outro usuário é removido.
- Uma configuração alterada à mão (uma publication removida, outra replica identity) é reparada na próxima execução, e uma execução sem nada a mudar não mostra nada.

Nada disso vai para os arquivos de migration: a senha do usuário de replicação vem do ambiente e nunca pode ser commitada. Todo `migrate run` alinha o banco com o schema, então um deploy configura o banco como qualquer outro ambiente. A senha nunca é exibida.

Criar o usuário de replicação exige um usuário de migration privilegiado: no PostgreSQL um superuser, ou no PostgreSQL 16+ um role com `CREATEROLE` e `REPLICATION`; no MySQL `CREATE USER` e os privilégios de replicação `WITH GRANT OPTION`. Quando falta o privilégio, o comando falha e mostra os comandos para você rodar. Quando `replication_url` usa o mesmo usuário de `database_url`, o Dinoco não gerencia esse usuário e só avisa quando falta `REPLICATION` a ele.

## Requisitos do servidor

| Banco | Requisito |
| --- | --- |
| PostgreSQL | 14 ou mais recente, com `wal_level = logical` (`ALTER SYSTEM SET wal_level = logical`, depois reinicie o servidor). Cada watch em execução ocupa um de `max_wal_senders` e um de `max_replication_slots` (10 de cada por padrão). `replication_url` precisa chegar ao PostgreSQL diretamente, não pelo PgBouncer. |
| MySQL | `log_bin` ligado, `binlog_format = ROW`, `binlog_row_image = FULL` e `binlog_row_value_options` vazio, o padrão do MySQL 8. |
| SQLite | Sem suporte: o SQLite não tem log para ler. Um schema em que todo workspace é SQLite não pode declarar `@@with_watch_changes`, e `observer` retorna `WatchError::Unsupported` num client SQLite, como o [test ambient](/pt-br/docs/orm/orm/testing). |

`migrate generate` e `migrate run` avisam quando falta uma configuração do servidor, e `observer` falha com `WatchError::NotConfigured`, citando a configuração, até ela ser corrigida.

## Observe um model

`watch::<M>()` monta o watch, `on_event` define o handler e `observer(&client)` conecta e o executa. Só models cujo model do schema declara `@@with_watch_changes` podem ser observados; `watch::<Bank>()` em qualquer outro model não compila.

```rust
pub enum WatchEvent<M> {
    Created(M),
    Updated { before: M, after: M },
    Deleted(M),
}
```

- `Created` traz a linha inserida, `Deleted` a linha como era, e `Updated` as duas versões da linha.
- As mudanças chegam quando a transaction delas faz commit, na ordem dos commits, e as mudanças de uma transaction com rollback nunca chegam.
- Um statement que altera várias linhas entrega um evento por linha.
- Todo field do model é decodificado, com os mesmos tipos de uma query: enums, JSON, datas, `NULL`s e valores grandes que o update não alterou. Os fields de relação vêm vazios, como numa query sem includes.
- `TRUNCATE` não é reportado.

## Filtre as mudanças

`filter` recebe uma closure sobre a linha e entrega só as mudanças que ela aceita:

```rust
watch::<Account>()
    .filter(|account| account.active)
    .on_event(|event| { /* ... */ })
    .observer(&client)
    .await?;
```

`Created` e `Deleted` são verificados contra a linha deles. Um update chega como `Updated` quando a linha passa no filtro **antes ou depois** dele, então uma linha que deixa de passar, ou passa a passar, continua sendo reportada, com as duas versões para comparar:

| Update | Entregue |
| --- | --- |
| Ativa antes e depois | `Updated` |
| Ativa antes, inativa depois | `Updated`, com `before.active == true` e `after.active == false` |
| Inativa antes, ativa depois | `Updated` |
| Inativa antes e depois | Nada |

## Handlers

O handler é uma closure que recebe cada evento. Ele pode não retornar nada ou retornar um `Result`, e pode ser async:

```rust
watch::<Account>()
    .on_event(|event| async move {
        if let WatchEvent::Created(account) = event {
            send_welcome_email(&account.email).await?;
        }
        Ok::<(), anyhow::Error>(())
    })
    .observer(&client)
    .await?;
```

- Os eventos são tratados um de cada vez: a próxima mudança é lida quando o handler retorna, ou quando o future dele termina.
- Um `Err` para o watch: `observer` retorna `WatchError::Handler` com o erro.
- Um handler lento segura todas as mudanças depois dele, então passe trabalho longo para uma fila (um job do [Rekka](/pt-br/docs/rekka/guide/introduction), por exemplo) em vez de fazê-lo no handler.

## Rode em segundo plano

`observer` roda até a conexão falhar ou o handler retornar um erro. Dispare-o numa task para mantê-lo rodando ao lado do resto da aplicação, e descarte o future dele para parar de observar, por exemplo com `tokio::select!` ou abortando a task:

```rust
let client = std::sync::Arc::new(crate::dinoco::connect().await?);

let accounts = tokio::spawn({
    let client = client.clone();
    async move {
        watch::<Account>()
            .on_event(|event| { /* ... */ })
            .observer(&client)
            .await
    }
});
```

Cada watch em execução ocupa uma conexão com o banco; no PostgreSQL ele também ocupa um slot de replicação temporário, que o servidor remove junto com a conexão.

## Entrega e reconexão

Um watch transmite as mudanças commitadas a partir do momento em que `observer` conecta. Mudanças feitas enquanto nenhum watch roda não são entregues depois, então um watch serve para reagir a mudanças, atualizar caches e enviar atualizações para clients, mas não substitui ler a tabela quando um processo inicia. Para continuar observando depois de perder a conexão, chame `observer` de novo:

```rust
loop {
    let result = watch::<Account>()
        .on_event(|event| { /* ... */ })
        .observer(&client)
        .await;
    if let Err(error) = result {
        eprintln!("o watch de accounts parou: {error}");
    }
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
}
```

## Erros

| `WatchError` | Quando |
| --- | --- |
| `Unsupported(database)` | O banco do client é SQLite. |
| `NotConfigured { table, reason }` | O servidor ou a tabela não está configurado: uma configuração do servidor, a publication ou a replica identity da tabela, os privilégios do usuário de replicação, ou um client PgBouncer sem `replication_url`. `reason` diz o que mudar. |
| `Decode { table }` | Uma linha transmitida não pôde ser decodificada no model, geralmente porque a tabela mudou e os models não foram regenerados. |
| `Database(error)` | A conexão falhou ou caiu. |
| `Handler(error)` | O handler retornou um erro. |
