/**
 * @namespace The action library, working with both synchronous and asynchronous actions.
 */
Action = {};

/**
 * The common states of all actions. The ordinary start state is Ready leads to only three transitions: from Ready to
 * Running, and from Running to both Done and Exception. For actions that are not fully initialized by their constructors,
 * there's also the state Init and a transition to Ready.
 * @enum {number}
 */
Action.State = {
  /**
   * An available start state for actions that use more then their constructors for initialization.
   */
  Init: 0,
  /**
   * The ordinary start state. An action is ready after it is fully initialized.
   */
  Ready: 1,
  /**
   * The subprogram of the action is currently running. The state is changed immediately upon the call to go() or run().
   */
  Running: 2,
  /**
   * The action completed without exception. In this case no catcher was called. The state is changed after the
   * subprogram has finished and before calling the finisher.
   */
  Done: 3,
  /**
   * The action threw an exception. In this case any catcher specified would be called. The state is changed
   * after the subprogram has finished and before calling the catcher.
   */
  Exception: 4
};

/**
 * The base action interface is just a marker.
 * @interface
 */
Action.Action_interface = function()
{
  /**
   * Every action is either reliable, which means that it's guaranteed to return control to the caller, or unreliable,
   * which means no such guarantee exists. Unreliable does not mean "never returns"; what would be the point of that?
   *
   * Reliability is a self-declaration for primitive actions. For composite actions, that is, actions that have at least
   * one other action within themselves, reliability can (often) be inferred.
   *
   * @expose
   * @type {boolean}
   */
  this.reliable = null;
};

/**
 *
 * @interface
 * @extends Action.Action_interface
 */
Action.Synchronous_Action_interface = function()
{
  /**
   * Every synchronous action is, by definition, reliable, since it always returns control to its caller. The return
   * of control can be either ordinary or exceptional, but that distinction is irrelevant to the meaning of "reliable".

   * @type {boolean}
   */
  this.reliable = true;
};

/**
 * The subprogram of a synchronous action is called 'run', to distinguish it from an asynchronous subprogram.
 */
Action.Synchronous_Action_interface.prototype.run = function()
{
};

//-------------------------------------------------------
/**
 * @interface
 * @extends Action.Action_interface
 */
Action.Asynchronous_Action_interface = function()
{
  /**
   * The default for an asynchronous action is unreliable. While some asynchronous actions are reliable, its prudent not
   * to assume that otherwise without specific knowledge.
   *
   * @type {boolean}
   */
  this.reliable = false;
};

Action.Asynchronous_Action_interface.prototype._go = function()
{
};


//-------------------------------------------------------
/**
 * @interface
 */
Action.Watcher_interface = function()
{
};
Action.Watcher_interface.prototype.good = function( id )
{
};
Action.Watcher_interface.prototype.bad = function( id )
{
};

//-------------------------------------------------------
/**
 * @constructor
 */
Action.Asynchronous_Action = function()
{
};

/**
 * @this {Action.Asynchronous_Action}
 */
Action.Asynchronous_Action.init = function()
{
  /**
   * The common state of a asynchronous action
   * @type {Action.State}
   * @private
   */
  this._state = Action.State.Ready;

  /**
   * @type {Array.<{watcher,id}>}
   */
  this._end_watchers = [];
};

Object.defineProperty( Action.Asynchronous_Action.prototype, "state", {
  get: function()
  {
    return this._state;
  }
} );

/**
 *
 * @param {function} [finisher]
 * @param {function} [catcher]
 */
Action.Asynchronous_Action.prototype.go = function( finisher, catcher )
{
  if ( this._state != Action.State.Ready )
  {
    throw new Error( "Call to go() is invalid because the action is not in state 'Ready'." );
  }
  this.finisher = finisher;
  this.catcher = catcher;
  this._state = Action.State.Running;
  this._go();
};

/**
 * Change state to Done and execute the finisher.
 *
 * @protected
 */
Action.Asynchronous_Action.prototype.end_well = function()
{
  function good()
  {
    this.watcher.good( this.id );
  }

  /*
   * Note that there's no exception handling in this function. In order to mimic the behavior of the try-finally
   * statement, an exception thrown from a finisher is treated as if it had happened within a finally block, which is to
   * say, it throws the exception. There's no need for extra code to do that.
   *
   * In addition, the state is left at Done if the finisher throws an exception. In this case, the exception does not
   * come from the action itself, but from user code. So regardless of how the finisher terminates, it does not change
   * that the action completed ordinarily.
   */
  this._state = Action.State.Done;
  this._each_watcher( good );
  if ( this.finisher ) this.finisher();
};

/**
 * Change state to Exception and execute the catcher followed by the finisher.
 *
 * @protected
 * @param e
 *    An exception value
 */
Action.Asynchronous_Action.prototype.end_badly = function( e )
{
  function bad()
  {
    this.watcher.bad( this.id, e );
  }

  /*
   * In contrast to end_well(), this function does require a try-finally statement. If the catcher throws an
   * exception, then we still have to execute the finisher anyway.
   */
  try
  {
    this._state = Action.State.Exception;
    this._each_watcher( bad );
    if ( this.catcher ) this.catcher( e );
  }
  finally
  {
    if ( this.finisher ) this.finisher();
  }
};

/**
 * Call a function on each watcher.
 *
 * @param {function} f
 *    A function to be called on the watcher structure.
 * @private
 */
Action.Asynchronous_Action.prototype._each_watcher = function( f )
{
  for ( var j = 0 ; j < this._end_watchers.length ; ++j )
  {
    try
    {
      /**
       * @type {{watcher:Action.Watcher_interface, id}}
       */
      var w = this._end_watchers[ j ];
      if ( !w )
      {
        /*
         * It's OK for a watcher to be null. All this means is that the watcher withdrew before completion.
         */
        continue;
      }
      f.call( w );
    }
    catch ( e )
    {
      /*
       * The use of this catch block is a defense so that we can ignore exceptions. There shouldn't be any, though, but
       * just in case.
       */
    }
    /*
     * Remove references all the end watchers at once by deleting the watcher array. Since we only run an action at
     * most once, this causes no adverse affect.
     */
    delete this._end_watchers;
  }
};

/**
 * Watch the ending of this action.
 *
 * @param {Action.Watcher_interface} watcher
 *    The watcher object.
 * @param {*} their_id
 *    An opaque identifier by which the peer identifies itself.
 * @returns {number}
 *    Our identifier, which is the index of
 */
Action.Asynchronous_Action.prototype.watch = function( watcher, their_id )
{
  return this._end_watchers.push( { watcher: watcher, id: their_id } ) - 1;
};

//noinspection JSUnusedGlobalSymbols
/**
 * Withdraw a watcher
 */
Action.Asynchronous_Action.prototype.withdraw = function( our_id )
{
  this._end_watchers[ our_id ] = null;
};

//-------------------------------------------------------
/**
 * @interface
 * @extends Action.Action_interface
 */
Action.Joinable = function()
{
};

//-----------------------------------------------------------------------------------------
// UTILITY
//-----------------------------------------------------------------------------------------
Action.dispatch = Action_Platform.dispatch;

//-----------------------------------------------------------------------------------------
// ACTIONS
//-----------------------------------------------------------------------------------------

//-------------------------------------------------------
// Defer
//-------------------------------------------------------
/**
 * Class constructor for Defer actions, which defer execution of a function (the "trial") until after the current
 * JavaScript-thread has run to completion.
 *
 * @constructor
 * @implements Action.Asynchronous_Action_interface
 */
Action.Defer_class = function()
{
  /**
   * @const
   * @type {boolean}
   */
  this.reliable = true;
};
Action.Defer_class.prototype = new Action.Asynchronous_Action();

/**
 *
 */
Action.Defer_class.prototype._go = function()
{
  Action.dispatch( this._body.bind( this ) );
};

/**
 * The deferred trial is run inside of a try-catch-finally statement.
 * @private
 */
Action.Defer_class.prototype._body = function()
{
  try
  {
    if ( this.try_f ) this.try_f();
  }
  catch ( e )
  {
    this.end_badly( e );
    return;
  }
  this.end_well();
};

/**
 * Instance constructor for standard Defer actions.
 * @param f
 * @constructor
 */
Action.Defer = function( f )
{
  Action.Asynchronous_Action.init.call( this );
  this.try_f = f;
};
Action.Defer.prototype = new Action.Defer_class();

//-------------------------------------------------------
/**
 *
 * @constructor
 * @implements Action.Asynchronous_Action_interface
 */
Action.Delay_class = function()
{
  /**
   * Delay actions always complete, even if cancelled or aborted early.
   * @const
   * @type {boolean}
   */
  this.reliable = true;
};
Action.Delay_class.prototype = new Action.Asynchronous_Action();

/**
 * Initialization function for use by instance constructors.
 * @param f
 * @param duration
 */
Action.Delay_class.init = function( f, duration )
{
  Action.Asynchronous_Action.init.call( this );
  this.try_f = f;
  this.duration = duration;
};

Action.Delay_class.prototype._go = function()
{
  this.timer_id = Action_Platform.set_timer( this._body.bind( this ), this.duration );
};

Action.Delay_class.prototype._body = function()
{
  try
  {
    if ( this.try_f ) this.try_f();
  }
  catch ( e )
  {
    this.end_badly( e );
    return;
  }
  this.end_well();
};

Action.Delay_class.prototype._terminate = function()
{
  Action_Platform.clear_timer( this.timer_id );
};

/**
 * Terminate this action without prejudice. The finisher will run as always.
 */
Action.Delay_class.prototype.cancel = function()
{
  this._terminate();
  this.end_well();
};

//noinspection JSUnusedGlobalSymbols
/**
 * Terminate this action with prejudice (but not extreme prejudice). The catcher and finisher will run.
 */
Action.Delay_class.prototype.abort = function( e )
{
  this._terminate();
  this.end_badly( e ? e : new Error( "Aborted forcibly." ) );
};


Action.Delay = function( f, duration )
{
  Action.Delay_class.init.call( this, f, duration );
};
Action.Delay.prototype = new Action.Delay_class();

//-----------------------------------------------------------------------------------------
// JOIN
//-----------------------------------------------------------------------------------------
/*
 * The first definitions are interfaces for join messaging. Some classes generate join messages, such as those that
 * wait for another action to complete. Some accept join messages, just as Join_class itself. Yet others, however, the
 * category of condition transformers, both generate and accept such messages, just as the gate for join-with-timeout.
 * As a consequence, we need to define these interfaces separately, so that, for example, both join actions and
 * condition transformers can each consistently accept messages
 */

/**
 * Interface for a receiver of join messages.
 * @interface
 */
Action.JM_Attentive = function()
{
};

/**
 * Receive a notice that a dependent condition has completed well.
 *
 * @param id
 */
Action.JM_Attentive.prototype.notice_good = function( id )
{
};

/**
 * Receive a notice that a dependent condition has completed badly.
 *
 * @param {*} id
 *    The identifier for the dependent condition in case there's more than one.
 * @param {*} e
 *    An exception object as it appears in a catch clause.
 */
Action.JM_Attentive.prototype.notice_bad = function( id, e )
{
};

/**
 * Interface for a sender of join messages. This interface is required because reporters have state that may need to be
 * queried by a receiver.
 * @interface
 */
Action.JM_Reporting = function()
{
};


//-------------------------------------------------------
// Join_class
//-------------------------------------------------------
/**
 *
 * @constructor
 * @implements {Action.JM_Attentive}
 */
Action.Join_class = function()
{
};
Action.Join_class.prototype = new Action.Asynchronous_Action();

/**
 *
 * @this {Action.Join_class}
 * @param action
 */
Action.Join_class.init = function( action )
{
  if ( !action )
    throw new Error( "Action to be joined may not be null" );
  Action.Asynchronous_Action.init.call( this );
  this.joined_action = action;
};

Action.Join_class.prototype._go = function()
{
  if ( this.joined_action.state <= Action.State.Running )
  {
  }
  else
  {
    throw new Error( "Not implemented: join.go() on completed action" );
  }
};

Action.Join_class.prototype.notice_good = function( id )
{
  this.end_well();
};
Action.Join_class.prototype.notice_bad = function( id, e )
{
  this.end_badly( e );
};


//-------------------------------------------------------
// Join
//-------------------------------------------------------
/**
 * Join with another action. The completion of the action joined allows the join action to complete.
 *
 * @constructor
 * @param {Action.Asynchronous_Action} action
 */
Action.Join = function( action )
{
  Action.Join_class.init.call( this, action );

  if ( this.joined_action.state <= Action.State.Running )
  {
    this.condition = new Action.JC_Wait( this, action );
    this.joined_action.watch( this, null );
  }
  else
  {
    throw new Error( "Not implemented: join constructor on completed action" );
  }
};
Action.Join.prototype = new Action.Join_class();

//-------------------------------------------------------
// Join_Timeout
//-------------------------------------------------------
/**
 * Join with another action and set a timer that may preemptively complete.
 *
 * @constructor
 * @param {Action.Asynchronous_Action} action
 * @param duration
 */
Action.Join_Timeout = function( action, duration )
{
  Action.Join_class.init.call( this, action );
};
Action.Join_Timeout.prototype = new Action.Join_class();

//-------------------------------------------------------
// Join Conditions
//-------------------------------------------------------
/**
 *
 * @interface
 * @extends Action.Watcher_interface
 */
Action.Join_Condition = function()
{
};

//-------------------------------------------------------
/**
 *
 * @constructor
 * @implements {Action.Join_Condition}
 */
Action.JC_Wait = function( join_action, wait_action )
{
  this.join_action = join_action;
  this.wait_action = wait_action;
  this.wait_action.watch( this, null );
};

Action.JC_Wait.prototype.good = function()
{
  this.join_action.notice_good( null );
};
Action.JC_Wait.prototype.bad = function( e )
{
  this.join_action.notice_bad( null, e );
};

//-------------------------------------------------------
/**
 *
 * @param duration
 * @constructor
 */
Action.JC_Gate_Timeout = function( duration )
{
  this.bound_ding = this.ding.bind( this );
  this.timer = Action_Platform.set_timer( this.bound_ding, duration );
};

/**
 * The timer just went off.
 */
Action.JC_Gate_Timeout.prototype.ding = function()
{
};

/**
 * Cancel the timer before it goes off.
 */
Action.JC_Gate_Timeout.prototype.cancel = function()
{
  Action_Platform.clear_timer( this.bound_ding );
};

//-------------------------------------------------------
/**
 * @constructor
 * @implements {Action.Join_Condition}
 * @param {Array.Joinable} actions
 */
Action.Join_Conjunction = function( actions )
{
  /**
   * The conjunction of actions is reliable only if all the actions are reliable.
   */
  this.reliable = true;
  for ( var j = 0 ; j < actions.length ; ++j )
  {
    if ( !actions[ j ].reliable )
    {
      this.reliable = false;
      break;
    }
  }
};

Action.Join_Conjunction.prototype.good = function()
{
};

Action.Join_Conjunction.prototype.bad = function()
{
};
