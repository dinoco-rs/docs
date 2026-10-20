# Leitura e escrita

Todo método do cache recebe o tipo cacheado como parâmetro genérico, então o namespace, o TTL e a decodificação sempre batem com o tipo.

## Escrevendo

```rust
let business = Business { id: 7, name: "Acme".into(), plan: "pro".into() };

cache.insert(&business).await?;                                     // usa o TTL do tipo
cache.insert_with_ttl(&business, Duration::from_secs(30)).await?;   // sobrescreve o TTL nesta escrita
cache.insert_many(&businesses).await?;                              // muitas entradas, poucas idas ao Redis
```

| Método | Efeito |
| --- | --- |
| `insert(&item)` | Grava ou substitui a entrada, com o TTL do tipo. |
| `insert_with_ttl(&item, ttl)` | Grava ou substitui a entrada com um TTL específico. |
| `insert_many(items)` | Grava muitas entradas com o TTL do tipo, em pipelines de 1.000. Aceita qualquer iterador de `&T`. |

## Lendo

```rust
let one: Option<Business> = cache.get::<Business>(7).await;
let many: Vec<Option<Business>> = cache.get_many::<Business>([7, 8, 9]).await?;
let cached: bool = cache.contains::<Business>(7).await?;
```

| Método | Retorna |
| --- | --- |
| `get::<T>(key)` | `Some(valor)`, ou `None` quando a entrada não existe, expirou, está em um formato incompatível, a key é vazia ou o Redis está inacessível. Nunca retorna erro. |
| `get_many::<T>(keys)` | Um `Option<T>` por key, **na mesma ordem** das keys, lidos em blocos de 1.000. |
| `contains::<T>(key)` | Se a entrada existe, sem lê-la. |

Keys são qualquer coisa que implemente `Display`, igual ao campo de key. Para um tipo com template de key de um único campo, passe o valor do campo ou a key completa: veja [Keys dinâmicas](/pt-br/docs/rekka/cache/cache-types#keys-dinamicas).

## Removendo

```rust
let existed: bool = cache.remove::<Business>(7).await?;
let removed: u64 = cache.remove_many::<Business>([8, 9]).await?;
let cleared: u64 = cache.clear::<Business>().await?;
```

| Método | Retorna |
| --- | --- |
| `remove::<T>(key)` | Se havia uma entrada para remover. |
| `remove_many::<T>(keys)` | Quantas das keys existiam. |
| `clear::<T>()` | Quantas entradas do tipo foram removidas. Varre de forma incremental e nunca bloqueia o Redis. |

## Um helper de read-through

O padrão mais comum é ler do cache e cair para o banco quando não encontra:

```rust
async fn business(cache: &Cache, db: &Database, id: i64) -> anyhow::Result<Option<Business>> {
    if let Some(cached) = cache.get::<Business>(id).await {
        return Ok(Some(cached));
    }

    let Some(fresh) = db.find_business(id).await? else {
        return Ok(None);
    };

    cache.insert(&fresh).await?;
    Ok(Some(fresh))
}
```

Depois de gravar no banco, chame `cache.remove::<Business>(id)` (ou faça `insert` do valor novo) para que ninguém leia dados velhos até o TTL acabar.

## Erros

O `get` nunca falha: uma falha é lida como ausência e vai para o log via `tracing`, então um cache indisponível cai para o banco de dados em vez de derrubar a requisição. Os outros métodos do cache retornam `rekka::Result`. Espere `RekkaError::Redis` quando o Redis estiver fora do ar, `RekkaError::Serialization` quando um valor não puder ser codificado e `RekkaError::InvalidKey` para uma key vazia. Um valor que não pode ser decodificado não é erro: ele é lido como `None`.
