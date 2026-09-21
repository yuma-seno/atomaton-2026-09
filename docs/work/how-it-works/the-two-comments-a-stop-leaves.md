# Two comments, and why they are not the same one twice

Stopping a run — by `/stop` or by closing the issue — leaves two comments seconds
apart, and they are written by different things that know different halves.

The first is a **receipt**, from the workflow your action triggered. It knows that
you acted, that a run holds the issue, and that a stop has been asked for. It does
not know whether the run stops, whether its session survives, or that `/resume` will
work, so it does not say any of those.

The second is the **record**, from the run itself. It knows it stopped, how far it
got, and that the session is saved — and it is the one that mentions you, because
that is the moment the turn comes back.

So only one notification arrives per stop, from the comment that has something for
you to act on. If a run dies without posting its record, the receipt still stands
and `atomaton/in-progress` stays on the issue, which is the sign to look at the run.

An agent closing the issue it is working on is a different thing and is left alone.
That is how a run finishes.
